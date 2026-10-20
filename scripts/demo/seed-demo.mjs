// Fills a fresh system with realistic demo data by using the real API, so every rule, number series, stock movement and
// audit row is exactly what the application would produce. Run it against a running API (see docs/DEMO_DATA.md).
import { Api, ApiError, isoDay, log, makeGstin, money, rng } from './client.mjs';
import {
  AREAS,
  BRANCHES,
  BROKERS,
  BUSINESSES,
  COMPANY,
  FIRST,
  ITEMS,
  LAST,
  LEAD_INTERESTS,
  LOST_REASONS,
  PASSWORD,
  STAFF_PAY,
  SUPPLIERS,
  USERS,
} from './data.mjs';

const config = {
  baseUrl: process.env.DEMO_API_URL ?? 'http://localhost:3000',
  origin: process.env.DEMO_ORIGIN ?? process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  superUser: process.env.DEMO_SUPER_USERNAME ?? 'superadmin',
  superPassword: process.env.DEMO_SUPER_PASSWORD ?? process.env.SEED_SUPER_ADMIN_PASSWORD ?? '',
};
const r = rng(20261011);
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

/** Everything the phases share. */
const world = {
  admin: null, // the owner's session
  sessions: {}, // username -> Api
  branch: {}, // code -> { id, ... }
  user: {}, // username -> { id, ... }
  item: {}, // code -> { id, ... }
  supplier: [], // { id, name, supplies }
  broker: [],
  customer: [], // { id, name, phone, branch }
  category: {},
  roles: {},
};

/** The owner, working inside one branch. */
const inBranch = (code) => {
  const api = new Api({
    baseUrl: config.baseUrl,
    origin: config.origin,
    label: `superadmin@${code}`,
  });
  api.cookies = new Map(world.admin.cookies);
  api.csrf = world.admin.csrf;
  api.branchId = world.branch[code].id;
  return api;
};

// ---------------------------------------------------------------------------------------------------------------
async function setup() {
  log('Setting up the company, branches and people');
  world.admin = new Api({ baseUrl: config.baseUrl, origin: config.origin, label: 'superadmin' });
  await world.admin.login(config.superUser, config.superPassword);

  const existing = await world.admin.all('/branches');
  if (existing.length > 1 && !process.env.DEMO_ALLOW_NON_EMPTY)
    throw new Error(
      'This system already has several branches. The demo data is meant for an empty system (set DEMO_ALLOW_NON_EMPTY=1 to go on anyway).',
    );

  const settings = [
    ['company.name', COMPANY.name],
    ['company.address', COMPANY.address],
    ['company.phone', COMPANY.phone],
    ['company.email', COMPANY.email],
    ['company.gstin', makeGstin('19', COMPANY.pan, '1')],
  ];
  // A setting that was already saved (by an earlier attempt) needs its version number to be changed again.
  const saved = new Map(
    (await world.admin.get('/settings')).map((setting) => [setting.key, setting]),
  );
  for (const [key, value] of settings) {
    const rowVersion = saved.get(key)?.source === 'SETTING' ? saved.get(key).rowVersion : null;
    await world.admin.put(
      `/settings/${key}`,
      rowVersion === null ? { value } : { value, rowVersion },
    );
  }

  // Head office: rename it and give it a GSTIN.
  // The head office is the branch the base seed created, whatever code it was given (for example HQ or KOL).
  const head = existing.find((b) => b.code === 'KOL') ?? existing[0];
  if (!head)
    throw new Error('No branch found. Run the base seed first (pnpm db:seed, or pnpm db:setup).');
  const kol = await world.admin.patch(`/branches/${head.id}`, {
    name: 'Kolkata - Salt Lake (Head Office)',
    gstin: makeGstin('19', COMPANY.pan, '1'),
    rowVersion: head.rowVersion,
  });
  world.branch.KOL = kol;
  for (const spec of BRANCHES) {
    world.branch[spec.code] = await world.admin.post('/branches', {
      code: spec.code,
      name: spec.name,
      stateCode: '19',
      gstin: makeGstin('19', COMPANY.pan, spec.entity),
    });
  }

  const roles = await world.admin.get('/roles');
  for (const role of roles) world.roles[role.tier] = role.id;

  for (const person of USERS) {
    const created = await world.admin.post('/users', {
      username: person.username,
      fullName: person.fullName,
      email: `${person.username}@bengaltoto.example`,
      roleId: world.roles[person.role],
      branchIds: person.branches.map((code) => world.branch[code].id),
    });
    world.user[person.username] = created.user;
    // First sign-in with the temporary password, then set the demo password.
    const api = new Api({ baseUrl: config.baseUrl, origin: config.origin, label: person.username });
    await api.login(person.username, created.temporaryPassword);
    await api.post('/auth/change-password', {
      currentPassword: created.temporaryPassword,
      newPassword: PASSWORD,
    });
    await api.login(person.username, PASSWORD);
    world.sessions[person.username] = api;
  }
  log(`  ${Object.keys(world.branch).length} branches, ${USERS.length + 1} people`);
}

// ---------------------------------------------------------------------------------------------------------------
async function masters() {
  log('Creating the catalogue, suppliers, brokers and customers');
  const manager = world.sessions['soumik.dutta'];
  const flat = [];
  const walk = (list) => {
    for (const c of list) {
      flat.push(c);
      walk(c.children ?? []);
    }
  };
  walk(await world.admin.get('/item-categories'));
  for (const c of flat) world.category[c.name] = c.id;

  for (const [code, name, category, hsn, tax, serialized, reorder] of ITEMS) {
    world.item[code] = await manager.post('/items', {
      itemCode: code,
      name,
      categoryId: world.category[category],
      unitCode: 'PCS',
      hsnCode: hsn,
      taxRate: tax,
      reorderLevel: reorder,
      isSerialized: serialized,
      generateBarcode: true,
    });
  }
  for (const [name, , stateCode, pan, entity, phone, supplies] of SUPPLIERS) {
    const s = await manager.post('/suppliers', {
      name,
      gstin: makeGstin(stateCode, pan, entity),
      phone,
      stateCode,
    });
    world.supplier.push({ ...s, supplies });
  }
  for (const [name, phone, type, value] of BROKERS) {
    const b = await manager.post('/brokers', { name, phone });
    await manager.post(`/brokers/${b.id}/rules`, { type, value });
    world.broker.push(b);
  }

  // Customers: owner-drivers, a few fleet businesses, and some from Bihar and Jharkhand (interstate sales).
  const usedPhones = new Set();
  const phone = () => {
    for (;;) {
      const number = `${r.pick(['9', '8', '7', '6'])}${String(r.int(0, 999999999)).padStart(9, '0')}`;
      if (!usedPhones.has(number)) {
        usedPhones.add(number);
        return number;
      }
    }
  };
  const make = async (customer, branch) => {
    const created = await world.sessions[branchStaff(branch)].post('/customers', customer);
    world.customer.push({ ...created, branch, business: Boolean(customer.gstin) });
  };
  for (let i = 0; i < 96; i += 1) {
    const branch = r.pick(['KOL', 'KOL', 'KOL', 'HWH', 'HWH', 'SLG', 'DGP']);
    const interstate = r.chance(0.06);
    await make(
      {
        name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
        phone: phone(),
        address: `${r.int(1, 220)}, ${r.pick(AREAS[branch])}`,
        stateCode: interstate ? r.pick(['10', '20']) : '19',
      },
      branch,
    );
  }
  for (const [index, name] of BUSINESSES.entries()) {
    const branch = ['KOL', 'KOL', 'KOL', 'HWH', 'SLG', 'DGP', 'KOL', 'KOL', 'DGP', 'SLG'][index];
    await make(
      {
        name,
        phone: phone(),
        email: `accounts${index + 1}@${name
          .toLowerCase()
          .replace(/[^a-z]/g, '')
          .slice(0, 14)}.example`,
        address: `${r.int(1, 90)}, ${r.pick(AREAS[branch])}`,
        stateCode: '19',
        gstin: makeGstin(
          '19',
          `${r.pick(['AAAC', 'AAAF', 'AABF'])}${String.fromCharCode(65 + index)}${r.int(1000, 9999)}${String.fromCharCode(66 + index)}`,
          '1',
        ),
      },
      branch,
    );
  }
  log(
    `  ${Object.keys(world.item).length} items, ${world.supplier.length} suppliers, ${world.broker.length} brokers, ${world.customer.length} customers`,
  );
}

const BRANCH_STAFF = {
  KOL: ['tanmoy.saha', 'priya.bose'],
  HWH: ['sanjay.das', 'kaushik.paul'],
  SLG: ['moumita.pal', 'tenzing.sherpa'],
  DGP: ['rajesh.kar', 'rajesh.kar'],
};
const BRANCH_ADMIN = {
  KOL: 'soumik.dutta',
  HWH: 'rina.mondal',
  SLG: 'abhijit.roy',
  DGP: 'partha.ghosh',
};
const branchStaff = (code) => r.pick(BRANCH_STAFF[code]);

// ---------------------------------------------------------------------------------------------------------------
const BASE_QTY = {
  'TOTO Vehicles': 5,
  'Lead-acid batteries': 12,
  'Lithium-ion batteries': 4,
  'Motors and Controllers': 7,
  Chargers: 8,
  'Tyres and tubes': 30,
  'Body and chassis': 17,
  'Electrical and wiring': 20,
  'Brakes and suspension': 20,
  Accessories: 33,
};
const BRANCH_SCALE = { KOL: 1.6, HWH: 0.7, SLG: 0.6, DGP: 0.55 };
const itemDef = Object.fromEntries(ITEMS.map((row) => [row[0], row]));
const seqByItem = {};
const serialFor = (code) => {
  seqByItem[code] = (seqByItem[code] ?? 0) + 1;
  return `${code.replace(/-/g, '')}${String(2600 + seqByItem[code]).padStart(5, '0')}`;
};
const monthsAgo = (months, extraDays = 0) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return isoDay(-extraDays, d);
};

function serialsFor(code, qty, { aged = false } = {}) {
  const [, , category] = itemDef[code];
  const out = [];
  for (let i = 0; i < qty; i += 1) {
    const serial = { serialNo: serialFor(code) };
    if (category === 'TOTO Vehicles') {
      serial.chassisNo = `MD2${code.replace(/-/g, '')}${r.int(100000, 999999)}`;
      serial.manufacturedOn = monthsAgo(r.int(1, 3), r.int(0, 20));
      serial.warrantyMonths = 12;
    } else {
      // Batteries: nearly all are fresh. In two models, one unit has already expired and one expires within a month.
      const old = aged && (code === 'BAT-EX150' || code === 'BAT-LG120') && i < 2;
      const made = old
        ? i === 0
          ? monthsAgo(19, r.int(0, 20))
          : monthsAgo(17, r.int(8, 14))
        : monthsAgo(r.int(0, 5), r.int(0, 20));
      serial.manufacturedOn = made;
      const d = new Date(`${made}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 18);
      serial.expiryOn = isoDay(0, d);
      serial.warrantyMonths = code === 'BAT-LI48' ? 36 : r.pick([12, 18, 24]);
    }
    out.push(serial);
  }
  return out;
}

async function buyFor(
  code,
  supplier,
  picks,
  { shortItem = null, damagedItem = null, daysAgo = 20, aged = false } = {},
) {
  const admin = world.sessions[BRANCH_ADMIN[code]];
  const owner = inBranch(code);
  const lines = picks.map(([item, qty]) => {
    const jitter = 1 + (r.next() - 0.5) * 0.06;
    return {
      itemId: world.item[item].id,
      qtyOrdered: qty,
      unitCost: money(Math.round(itemDef[item][7] * jitter)),
    };
  });
  const po = await admin.post('/purchase-orders', {
    supplierId: supplier.id,
    orderDate: isoDay(-daysAgo),
    lines,
  });
  const approved = await owner.post(`/purchase-orders/${po.id}/approve`, {
    rowVersion: po.rowVersion,
  });
  const receiveLines = approved.lines.map((line) => {
    const item = picks.find(([c]) => world.item[c].id === line.itemId);
    const [itemCode, qty] = item;
    if (itemDef[itemCode][5]) {
      const serials = serialsFor(itemCode, qty, { aged });
      if (damagedItem === itemCode) serials[0].damaged = true;
      return { poLineId: line.id, serials };
    }
    const received = shortItem === itemCode ? Math.max(1, qty - 3) : qty;
    return {
      poLineId: line.id,
      received,
      damaged: damagedItem === itemCode ? 2 : 0,
      deliveryNoteQty: qty,
    };
  });
  await world.sessions[BRANCH_STAFF[code][0]].post(`/purchase-orders/${po.id}/receive`, {
    lines: receiveLines,
    deliveryNoteNo: `DN-${r.int(10000, 99999)}`,
  });
  return po;
}

async function stock() {
  log('Buying stock from suppliers and receiving it');
  const plan = { KOL: 28, HWH: 21, SLG: 17, DGP: 14 };
  for (const code of ['KOL', 'HWH', 'SLG', 'DGP']) {
    let day = plan[code];
    for (const supplier of world.supplier) {
      const picks = supplier.supplies.map((item) => {
        const category = itemDef[item][2];
        const base = BASE_QTY[category] ?? 10;
        return [item, Math.max(1, Math.round(base * BRANCH_SCALE[code] * (0.7 + r.next() * 0.6)))];
      });
      const extras = {};
      if (code === 'HWH' && supplier.name.startsWith('Shree Ganesh')) {
        extras.shortItem = 'MUD-RR';
      }
      if (code === 'SLG' && supplier.name.startsWith('Shree Ganesh')) {
        extras.damagedItem = 'SHK-PAIR';
      }
      if (code === 'DGP' && supplier.name.startsWith('Power Cell')) {
        extras.damagedItem = 'CHG-48-10';
      }
      await buyFor(code, supplier, picks, {
        daysAgo: day,
        aged: supplier.name.startsWith('Power Cell'),
        ...extras,
      });
      day = Math.max(2, day - 3);
    }
  }
  const balances = await world.admin.all('/stock/balances');
  log(`  ${balances.length} stock lines across branches`);
}

// ---------------------------------------------------------------------------------------------------------------
async function availableSerials(api, branchCode, itemCode, count) {
  const rows = await api.all(
    `/stock/serial-units?branchId=${world.branch[branchCode].id}&itemId=${world.item[itemCode].id}&state=AVAILABLE`,
  );
  return rows
    .filter((row) => !blockedSerials.has(row.serialNo))
    .slice(0, count)
    .map((row) => row.serialNo);
}
/** Expired batteries stay in stock (so the expiry alerts have something to show) but are never sold. */
const blockedSerials = new Set();

async function transfer(from, to, picks, until, damage = false) {
  const fromAdmin = world.sessions[BRANCH_ADMIN[from]];
  const toAdmin = world.sessions[BRANCH_ADMIN[to]];
  // The branch that needs the stock asks for it; the branch that holds it approves and sends.
  const created = await toAdmin.post('/transfers', {
    fromBranchId: world.branch[from].id,
    toBranchId: world.branch[to].id,
    note: `Stock for ${world.branch[to].name}`,
    lines: picks.map(([item, qty]) => ({ itemId: world.item[item].id, qty })),
  });
  if (until === 'requested') return created;
  const approved = await inBranch(from).post(`/transfers/${created.id}/approve`, {
    rowVersion: created.rowVersion,
  });
  if (until === 'approved') return approved;
  const items = [];
  for (const [item, qty] of picks) {
    items.push(
      itemDef[item][5]
        ? {
            itemId: world.item[item].id,
            serialNos: await availableSerials(fromAdmin, from, item, qty),
          }
        : { itemId: world.item[item].id, qty },
    );
  }
  const dispatched = await world.sessions[BRANCH_STAFF[from][0]].post(
    `/transfers/${created.id}/dispatch`,
    {
      rowVersion: approved.rowVersion,
      note: 'Sent by road',
      items,
    },
  );
  if (until === 'dispatched') return dispatched;
  // Parts arrive in counted lines; vehicles and batteries arrive one serial number at a time.
  const lines = dispatched.lines
    .filter((line) => !line.isSerialized)
    .map((line, index) => ({
      lineId: line.id,
      received: line.qtySent,
      damaged: damage && index === 0 ? 1 : 0,
    }));
  const serials = dispatched.lines
    .filter((line) => line.isSerialized)
    .map((line) => ({ serialNo: line.serialNo }));
  return toAdmin.post(`/transfers/${created.id}/receive`, {
    rowVersion: dispatched.rowVersion,
    note: damage ? 'One piece arrived damaged' : 'Checked on arrival',
    ...(lines.length > 0 ? { lines } : {}),
    ...(serials.length > 0 ? { serials } : {}),
  });
}

async function transfers() {
  log('Moving stock between branches and adjusting counts');
  await transfer(
    'KOL',
    'HWH',
    [
      ['TOTO-CL4', 2],
      ['BAT-EX150', 4],
      ['CHG-48-10', 3],
      ['TYR-350-12', 10],
    ],
    'received',
  );
  await transfer(
    'KOL',
    'SLG',
    [
      ['TOTO-DX5', 1],
      ['BAT-AM135', 3],
      ['CTR-48', 4],
      ['HLP-LED', 6],
    ],
    'received',
  );
  await transfer(
    'KOL',
    'DGP',
    [
      ['TOTO-LT3', 1],
      ['MOT-1000', 2],
      ['BRK-SHOE-F', 8],
    ],
    'received',
  );
  await transfer('HWH', 'KOL', [['TUB-350-12', 6]], 'received', true); // one piece arrives damaged
  await transfer(
    'KOL',
    'SLG',
    [
      ['BAT-LG120', 3],
      ['CHG-60-12', 2],
    ],
    'dispatched',
  ); // on its way
  await transfer(
    'KOL',
    'DGP',
    [
      ['BAT-EX150', 3],
      ['SHK-PAIR', 4],
    ],
    'dispatched',
  );
  await transfer(
    'KOL',
    'HWH',
    [
      ['TOTO-CG2', 1],
      ['WIR-HAR', 4],
    ],
    'approved',
  ); // waiting to be sent
  await transfer('SLG', 'KOL', [['SEAT-CVR', 5]], 'requested'); // waiting for approval
  await transfer(
    'HWH',
    'DGP',
    [
      ['MIR-SET', 6],
      ['USB-PORT', 10],
    ],
    'requested',
  );

  // Stock adjustments: a count correction, a write-off of damaged stock, and requests still waiting.
  const adj = async (code, who, body, decision) => {
    const created = await world.sessions[who].post('/stock/adjustments', {
      ...body,
      branchId: world.branch[code].id,
    });
    if (decision === 'approve')
      await inBranch(code).post(`/stock/adjustments/${created.id}/approve`, {
        rowVersion: created.rowVersion,
        note: 'Verified by physical count',
      });
    if (decision === 'reject')
      await inBranch(code).post(`/stock/adjustments/${created.id}/reject`, {
        rowVersion: created.rowVersion,
        note: 'Recount before adjusting',
      });
  };
  await adj(
    'KOL',
    'debojit.nandi',
    {
      itemId: world.item['TYR-350-12'].id,
      kind: 'OUT',
      state: 'AVAILABLE',
      qty: 2,
      reason: 'Two tyres found punctured in the store',
    },
    'approve',
  );
  await adj(
    'HWH',
    'kaushik.paul',
    {
      itemId: world.item['MUD-RR'].id,
      kind: 'IN',
      state: 'AVAILABLE',
      qty: 3,
      reason: 'Found three more in the back store during the count',
    },
    'approve',
  );
  await adj(
    'SLG',
    'tenzing.sherpa',
    {
      itemId: world.item['SHK-PAIR'].id,
      kind: 'WRITE_OFF',
      state: 'AVAILABLE',
      qty: 1,
      reason: 'Cracked housing found on unpacking, supplier claim rejected',
    },
    'approve',
  );
  await adj(
    'DGP',
    'rajesh.kar',
    {
      itemId: world.item['HRN-12'].id,
      kind: 'OUT',
      state: 'AVAILABLE',
      qty: 5,
      reason: 'Counted far fewer horns than the system shows',
    },
    'pending',
  );
  await adj(
    'KOL',
    'tanmoy.saha',
    {
      itemId: world.item['MIR-SET'].id,
      kind: 'OUT',
      state: 'AVAILABLE',
      qty: 4,
      reason: 'Mirrors cracked on display',
    },
    'pending',
  );
  await adj(
    'HWH',
    'sanjay.das',
    {
      itemId: world.item['KNG-KIT'].id,
      kind: 'IN',
      state: 'AVAILABLE',
      qty: 40,
      reason: 'Opening stock added again by mistake',
    },
    'reject',
  );

  // Receiving problems: resolve some, leave the rest open.
  const open = await world.admin.all('/discrepancies?status=OPEN');
  const resolutions = ['CLAIM', 'ACCEPT', 'RETURN'];
  for (const [i, d] of open.entries()) {
    if (i >= open.length - 2) break; // keep the last two open
    const owner =
      world.branch[
        Object.keys(world.branch).find((c) => world.branch[c].id === d.branchId) ?? 'KOL'
      ];
    const api = new Api({ baseUrl: config.baseUrl, origin: config.origin });
    api.cookies = new Map(world.admin.cookies);
    api.csrf = world.admin.csrf;
    api.branchId = owner.id;
    // Each kind of problem allows only some decisions; take the first one the system accepts.
    for (const resolution of [resolutions[i % 3], 'CLAIM', 'RETURN', 'ACCEPT', 'WRITE_OFF']) {
      const result = await api.request('POST', `/discrepancies/${d.id}/resolve`, {
        resolution,
        note: 'Settled with the supplier',
        rowVersion: d.rowVersion,
      });
      if (result.status === 200) break;
      if (result.status !== 422)
        throw new ApiError('POST', 'discrepancies/resolve', result.status, result.body);
    }
  }
  log(`  ${open.length} receiving problems found, ${Math.max(0, open.length - 2)} resolved`);
}

// ---------------------------------------------------------------------------------------------------------------
const stockLeft = new Map(); // `${branch}:${item}` -> units still available to sell
let paymentCounter = 0;
const idemKey = (label) => `demo-${label}-${String(++paymentCounter).padStart(5, '0')}`;

async function loadStock() {
  stockLeft.clear();
  blockedSerials.clear();
  for (const battery of await world.admin.all('/batteries?expiry=expired'))
    blockedSerials.add(battery.serialNo);
  for (const code of Object.keys(world.branch)) {
    const rows = await world.admin.all(`/stock/balances?branchId=${world.branch[code].id}`);
    for (const row of rows) stockLeft.set(`${code}:${row.itemCode}`, row.available);
  }
}
const haveStock = (code, item, qty) => (stockLeft.get(`${code}:${item}`) ?? 0) >= qty;
const useStock = (code, item, qty) =>
  stockLeft.set(`${code}:${item}`, (stockLeft.get(`${code}:${item}`) ?? 0) - qty);

const PARTS = ITEMS.filter((row) => !row[5]).map((row) => row[0]);
const VEHICLES = ['TOTO-CL4', 'TOTO-DX5', 'TOTO-CG2', 'TOTO-LT3'];
const BATTERIES = ['BAT-EX150', 'BAT-AM135', 'BAT-LG120', 'BAT-LI48'];
const price = (code, wobble = 0.03) =>
  Math.round(itemDef[code][8] * (1 + (r.next() - 0.5) * 2 * wobble));

/** Builds the lines of one sale and takes the units out of the local stock count. Returns null when nothing is available. */
async function basket(code, kind) {
  const api = world.sessions[BRANCH_ADMIN[code]];
  const lines = [];
  const add = async (item, qty, discount = 0) => {
    if (!haveStock(code, item, qty)) return false;
    if (itemDef[item][5]) {
      const serials = await availableSerials(api, code, item, qty);
      if (serials.length < qty) return false;
      for (const serialNo of serials) {
        const unit = (
          await api.all(
            `/stock/serial-units?branchId=${world.branch[code].id}&itemId=${world.item[item].id}&search=${serialNo}`,
          )
        )[0];
        lines.push({
          itemId: world.item[item].id,
          qty: 1,
          unitPrice: money(price(item)),
          serialUnitId: unit.id,
          ...(discount ? { discountAmount: money(discount) } : {}),
        });
      }
    } else {
      lines.push({
        itemId: world.item[item].id,
        qty,
        unitPrice: money(price(item)),
        ...(discount ? { discountAmount: money(discount) } : {}),
      });
    }
    useStock(code, item, qty);
    return true;
  };
  if (kind === 'vehicle') {
    const vehicle = r.pick(VEHICLES);
    if (!(await add(vehicle, 1, r.chance(0.35) ? r.pick([1000, 2000, 3000]) : 0))) return null;
    for (const extra of r
      .shuffle(['SEAT-CVR', 'MIR-SET', 'USB-PORT', 'HLP-LED'])
      .slice(0, r.int(0, 2)))
      await add(extra, 1);
  } else if (kind === 'battery') {
    const battery = r.pick(BATTERIES.slice(0, 3));
    const qty = r.pick([2, 4, 4, 6].filter((n) => haveStock(code, battery, n)).concat([1]));
    if (!(await add(battery, qty, r.chance(0.3) ? 200 * qty : 0))) return null;
    if (r.chance(0.4)) await add(r.pick(['CHG-48-10', 'CHG-60-12']), 1);
  } else {
    const picks = r.shuffle(PARTS).slice(0, r.int(1, 4));
    for (const item of picks)
      await add(item, r.int(1, item.startsWith('TYR') || item.startsWith('BRK') ? 4 : 2));
  }
  return lines.length > 0 ? lines : null;
}

async function sell(code, customer, kind, pay, opts = {}) {
  const lines = await basket(code, kind);
  if (!lines) return null;
  const api = world.sessions[r.pick(BRANCH_STAFF[code])];
  const nonGst = kind === 'parts' && !customer.business && r.chance(0.25);
  const broker = kind === 'vehicle' && r.chance(0.45) ? r.pick(world.broker) : null;
  const draft = await api.post('/invoices', {
    customerId: customer.id,
    type: nonGst ? 'NON_GST' : 'GST',
    lines,
    ...(broker ? { brokerId: broker.id } : {}),
    ...(opts.dueInDays !== undefined ? { dueDate: isoDay(opts.dueInDays) } : {}),
  });
  // A discount above what staff may give needs a manager to issue the invoice.
  const issuer = lines.some((line) => line.discountAmount)
    ? world.sessions[BRANCH_ADMIN[code]]
    : api;
  const issued = await issuer.post(`/invoices/${draft.id}/issue`, {
    rowVersion: draft.rowVersion,
    ...(pay.unpaid ? { unpaidDeliveryReason: pay.unpaid } : {}),
  });
  const total = Number(issued.total);
  if (pay.fraction > 0) {
    const amount = pay.fraction >= 1 ? total : Math.round(total * pay.fraction);
    await api.post('/payments', {
      customerId: customer.id,
      mode: pay.mode ?? r.pick(['UPI', 'UPI', 'CASH', 'BANK_TRANSFER']),
      amount: money(amount),
      paidOn: isoDay(0),
      idempotencyKey: idemKey('inv'),
      allocations: [{ invoiceId: issued.id, amount: money(amount) }],
      ...(pay.reference ? { reference: pay.reference } : {}),
    });
  }
  return issued;
}

async function sales() {
  log('Selling vehicles, batteries and parts');
  await loadStock();
  const modes = await world.admin.get('/reference/payment-modes');
  log(`  payment modes: ${modes.map((m) => m.code).join(', ')}`);
  const byBranch = (code) => world.customer.filter((c) => c.branch === code);
  const plan = { KOL: [12, 10, 17], HWH: [6, 5, 8], SLG: [4, 4, 6], DGP: [3, 4, 5] }; // vehicles, battery jobs, parts sales
  let made = 0;
  for (const code of Object.keys(plan)) {
    const [vehicles, batteries, parts] = plan[code];
    const jobs = [
      ...Array(vehicles).fill('vehicle'),
      ...Array(batteries).fill('battery'),
      ...Array(parts).fill('parts'),
    ];
    for (const kind of r.shuffle(jobs)) {
      const customer = r.pick(byBranch(code).length > 0 ? byBranch(code) : world.customer);
      const roll = r.next();
      const pay =
        roll < 0.62
          ? { fraction: 1 }
          : roll < 0.9
            ? { fraction: r.pick([0.3, 0.5, 0.6]) }
            : { fraction: 0, unpaid: 'Regular customer, payment promised within the week' };
      const invoice = await sell(
        code,
        customer,
        kind,
        pay,
        pay.fraction < 1 ? { dueInDays: r.pick([7, 15, 30, 45]) } : {},
      );
      if (invoice) made += 1;
    }
  }
  log(`  ${made} invoices issued`);
}

// ---------------------------------------------------------------------------------------------------------------
async function firstUnit(code, item) {
  const api = world.sessions[BRANCH_ADMIN[code]];
  const rows = (
    await api.all(
      `/stock/serial-units?branchId=${world.branch[code].id}&itemId=${world.item[item].id}&state=AVAILABLE`,
    )
  ).filter((row) => !blockedSerials.has(row.serialNo));
  return rows[0] ?? null;
}

async function quotation(code, customer, spec, until) {
  const staff = world.sessions[r.pick(BRANCH_STAFF[code])];
  const admin = world.sessions[BRANCH_ADMIN[code]];
  const lines = spec.items.map(([item, qty]) => ({
    itemId: world.item[item].id,
    qty,
    unitPrice: money(price(item, 0.02)),
  }));
  const created = await staff.post('/quotations', {
    customerId: customer.id,
    type: 'GST',
    validUntil: isoDay(r.int(10, 25)),
    lines,
    ...(spec.broker ? { brokerId: spec.broker.id } : {}),
    ...(spec.custom ? { isCustomBuild: true, specification: spec.custom } : {}),
  });
  if (until === 'draft') return created;
  if (until === 'cancel') {
    return staff.post(`/quotations/${created.id}/cancel`, {
      rowVersion: created.rowVersion,
      reason: 'Customer chose another dealer',
    });
  }
  const sent = await staff.post(`/quotations/${created.id}/send`, {
    rowVersion: created.rowVersion,
  });
  if (until === 'sent') return sent;
  const accepted = await staff.post(`/quotations/${created.id}/accept`, {
    rowVersion: sent.rowVersion,
  });
  const advance = Math.round(Number(accepted.total) * spec.advance);
  await staff.post(`/quotations/${created.id}/advance`, {
    mode: r.pick(['UPI', 'BANK_TRANSFER', 'CASH']),
    amount: money(advance),
    paidOn: isoDay(0),
    idempotencyKey: idemKey('adv'),
    note: 'Booking advance',
  });
  let current = await staff.get(`/quotations/${created.id}`);
  if (spec.custom) {
    for (const stage of spec.stages) {
      current = await admin.post(`/quotations/${created.id}/build`, {
        stage,
        note: `Build stage: ${stage.toLowerCase().replace('_', ' ')}`,
        rowVersion: current.rowVersion,
      });
    }
  }
  if (until === 'accepted') return current;
  // Give each vehicle line its unit, then turn the quotation into an invoice.
  for (const line of current.lines) {
    if (!itemDef[line.itemCode][5]) continue;
    const unit = await firstUnit(code, line.itemCode);
    if (!unit) throw new Error(`No ${line.itemCode} left in ${code} for the quotation`);
    current = await staff.post(`/quotations/${created.id}/lines/${line.id}/unit`, {
      serialUnitId: unit.id,
      chassisNo: unit.chassisNo ?? `CH${r.int(100000, 999999)}`,
      motorNo: `MT${r.int(100000, 999999)}`,
      rowVersion: current.rowVersion,
    });
  }
  const draft = await admin.post('/invoices/from-quotation', {
    quotationId: created.id,
    rowVersion: current.rowVersion,
    dueDate: isoDay(7),
  });
  const issued = await admin.post(`/invoices/${draft.id}/issue`, {
    rowVersion: draft.rowVersion,
    unpaidDeliveryReason: 'Balance to be paid by bank transfer when the vehicle is handed over',
  });
  if (spec.finalPayment) {
    const due = Number(issued.total) - advance;
    if (due > 0)
      await staff.post('/payments', {
        customerId: customer.id,
        mode: 'BANK_TRANSFER',
        amount: money(due),
        paidOn: isoDay(0),
        idempotencyKey: idemKey('qfinal'),
        allocations: [{ invoiceId: issued.id, amount: money(due) }],
        note: 'Balance on delivery',
      });
  }
  return issued;
}

async function quotations() {
  log('Quotations, advances and custom builds');
  await loadStock();
  const byBranch = (code) => world.customer.filter((c) => c.branch === code);
  const pickCustomer = (code) => r.pick(byBranch(code));
  const broker = () => r.pick(world.broker);
  const jobs = [
    [
      'KOL',
      {
        items: [
          ['TOTO-DX5', 1],
          ['SEAT-CVR', 1],
        ],
        advance: 0.3,
        finalPayment: true,
        broker: broker(),
      },
      'convert',
    ],
    ['KOL', { items: [['TOTO-CL4', 1]], advance: 0.4, finalPayment: true }, 'convert'],
    [
      'HWH',
      {
        items: [
          ['TOTO-CL4', 1],
          ['MIR-SET', 1],
        ],
        advance: 0.25,
        finalPayment: false,
        broker: broker(),
      },
      'convert',
    ],
    ['SLG', { items: [['TOTO-LT3', 1]], advance: 0.5, finalPayment: true }, 'convert'],
    ['KOL', { items: [['TOTO-CG2', 1]], advance: 0.3 }, 'accepted'],
    [
      'KOL',
      {
        items: [
          ['TOTO-DX5', 1],
          ['HOOD-SET', 1],
        ],
        advance: 0.2,
      },
      'accepted',
    ],
    ['DGP', { items: [['TOTO-CL4', 1]], advance: 0.35 }, 'accepted'],
    [
      'KOL',
      {
        items: [
          ['TOTO-CG2', 1],
          ['BAT-LI48', 1],
        ],
        advance: 0.4,
        custom:
          'Cargo loader with a lithium pack, extended 6 ft deck, rear tail-gate and amber beacon.',
        stages: ['IN_BUILD', 'QUALITY_CHECK'],
      },
      'accepted',
    ],
    [
      'HWH',
      {
        items: [
          ['TOTO-DX5', 1],
          ['HLP-LED', 2],
        ],
        advance: 0.3,
        custom:
          'Deluxe passenger model with white-and-green fleet livery and reinforced rear seat.',
        stages: ['IN_BUILD'],
      },
      'accepted',
    ],
    ['KOL', { items: [['TOTO-CL4', 2]], advance: 0 }, 'sent'],
    ['SLG', { items: [['TOTO-DX5', 1]], advance: 0 }, 'sent'],
    [
      'DGP',
      {
        items: [
          ['BAT-LI48', 2],
          ['CHG-48-10', 2],
        ],
        advance: 0,
      },
      'sent',
    ],
    ['HWH', { items: [['TOTO-LT3', 1]], advance: 0 }, 'draft'],
    ['KOL', { items: [['TOTO-CL4', 1]], advance: 0 }, 'cancel'],
  ];
  let done = 0;
  for (const [code, spec, until] of jobs) {
    if (spec.items.some(([item, qty]) => !haveStock(code, item, qty))) continue;
    await quotation(code, pickCustomer(code), spec, until);
    done += 1;
  }
  log(`  ${done} quotations`);
}

// ---------------------------------------------------------------------------------------------------------------
const codeOfBranch = (id) => Object.keys(world.branch).find((c) => world.branch[c].id === id);

async function afterSales() {
  log('Returns, credit notes, refunds, exchanges and later payments');
  const invoices = (await world.admin.all('/invoices?status=ISSUED')).filter(
    (i) => i.type === 'GST',
  );
  const detailed = [];
  for (const row of invoices) detailed.push(await world.admin.get(`/invoices/${row.id}`));

  // Credit notes for returned goods: approved, one waiting and one rejected.
  const returnable = detailed.filter((i) => i.lines.some((l) => !l.serialUnitId && l.qty >= 1));
  const picks = r.shuffle(returnable).slice(0, 6);
  const outcomes = ['approve', 'approve', 'approve', 'approve', 'pending', 'reject'];
  const reasons = [
    'Wrong part supplied, returned unused',
    'Defective on delivery, replaced under warranty',
    'Customer returned unused spare',
    'Price correction agreed after delivery',
    'Duplicate item billed',
    'Part did not fit the vehicle model',
  ];
  let creditCustomer = null;
  for (const [index, invoice] of picks.entries()) {
    const code = codeOfBranch(invoice.branchId);
    const line = invoice.lines.find((l) => !l.serialUnitId);
    const staff = world.sessions[r.pick(BRANCH_STAFF[code])];
    const note = await staff.post('/credit-notes', {
      invoiceId: invoice.id,
      reason: reasons[index],
      lines: [{ invoiceLineId: line.id, qty: 1 }],
    });
    if (outcomes[index] === 'approve') {
      await world.sessions[BRANCH_ADMIN[code]].post(`/credit-notes/${note.id}/approve`, {
        rowVersion: note.rowVersion,
      });
      creditCustomer ??= { invoice, code };
    } else if (outcomes[index] === 'reject') {
      await world.sessions[BRANCH_ADMIN[code]].post(`/credit-notes/${note.id}/reject`, {
        rowVersion: note.rowVersion,
        reason: 'Return window had passed',
      });
    }
  }

  // A refund of money the customer holds on account.
  let refunds = 0;
  const customers = await world.admin.get('/dues/customers?pageSize=1').catch(() => null);
  void customers;
  for (const invoice of detailed) {
    const code = codeOfBranch(invoice.branchId);
    const credit = await world.sessions[BRANCH_ADMIN[code]]
      .get(`/refunds/credit?customerId=${invoice.customerId}&branchId=${invoice.branchId}`)
      .catch(() => null);
    if (credit && Number(credit.refundable ?? credit.available ?? 0) > 0 && refunds < 2) {
      const amount = Math.min(Number(credit.refundable ?? credit.available), 1500);
      await world.sessions[BRANCH_ADMIN[code]].post('/refunds', {
        customerId: invoice.customerId,
        branchId: invoice.branchId,
        amount: money(amount),
        mode: 'UPI',
        paidOn: isoDay(0),
        reason: 'Refund of credit after an approved return',
        idempotencyKey: idemKey('refund'),
      });
      refunds += 1;
    }
  }

  // A payment that bounced, and a later payment for most invoices that were only part paid.
  const payments = await world.admin.all('/payments?status=ACTIVE');
  let reversed = 0;
  for (const payment of r
    .shuffle(payments.filter((p) => p.mode === 'BANK_TRANSFER' || p.mode === 'CASH'))
    .slice(0, 2)) {
    await world.sessions[BRANCH_ADMIN[codeOfBranch(payment.branchId)]].post(
      `/payments/${payment.id}/reverse`,
      { reason: 'Cheque deposited by the customer was returned unpaid' },
    );
    reversed += 1;
  }
  const dues = await world.admin.all('/dues?scope=outstanding');
  let catchUps = 0;
  for (const due of r.shuffle(dues)) {
    if (catchUps >= 14) break;
    const code = codeOfBranch(due.branchId);
    const outstanding = Number(due.outstanding);
    if (outstanding < 500) continue;
    const amount = r.chance(0.55) ? outstanding : Math.round(outstanding * r.pick([0.3, 0.5]));
    await world.sessions[r.pick(BRANCH_STAFF[code])]
      .post('/payments', {
        customerId: due.customerId,
        mode: r.pick(['UPI', 'BANK_TRANSFER', 'CASH']),
        amount: money(amount),
        paidOn: isoDay(0),
        idempotencyKey: idemKey('later'),
        allocations: [{ invoiceId: due.invoiceId, amount: money(amount) }],
      })
      .catch((error) => {
        if (!(error instanceof ApiError) || error.status >= 500) throw error;
      });
    catchUps += 1;
  }
  log(
    `  ${picks.length} credit notes, ${refunds} refunds, ${reversed} reversed payments, ${catchUps} later payments`,
  );

  // Exchanges: a customer who bought a vehicle earlier takes a newer one and hands the old one back.
  let exchanges = 0;
  await loadStock();
  for (const code of ['KOL', 'HWH']) {
    const customer = r.pick(world.customer.filter((c) => c.branch === code && !c.business));
    const first = await sell(code, customer, 'vehicle', { fraction: 1 });
    const second = await sell(code, customer, 'vehicle', { fraction: 1 });
    if (!first || !second) continue;
    const oldLine = first.lines.find((l) => l.serialUnitId && VEHICLES.includes(l.itemCode));
    const newLine = second.lines.find((l) => l.serialUnitId && VEHICLES.includes(l.itemCode));
    const request = await world.sessions[r.pick(BRANCH_STAFF[code])].post('/exchanges', {
      invoiceId: second.id,
      oldSerialUnitId: oldLine.serialUnitId,
      newSerialUnitId: newLine.serialUnitId,
      kind: 'OLD_FOR_NEW',
      valuationAmount: money(Math.round(Number(oldLine.unitPrice) * 0.45)),
      disposition: 'STOCK',
      reason: 'Customer upgrading to a newer model, old vehicle taken back',
    });
    if (exchanges === 0)
      await world.sessions[BRANCH_ADMIN[code]].post(`/exchanges/${request.id}/approve`, {
        rowVersion: request.rowVersion,
        note: 'Valuation agreed after inspection',
      });
    exchanges += 1;
  }
  log(`  ${exchanges} exchanges requested`);

  // Broker commission: pay some brokers, leave the rest payable.
  const payable = await world.admin.all('/commissions?status=PAYABLE');
  const byBroker = new Map();
  for (const commission of payable)
    byBroker.set(commission.brokerId, [...(byBroker.get(commission.brokerId) ?? []), commission]);
  let payouts = 0;
  for (const [, list] of [...byBroker].slice(0, Math.max(1, Math.floor(byBroker.size / 2)))) {
    await world.sessions['soumik.dutta']
      .post('/commissions/payout', {
        commissionIds: list.map((c) => c.id),
        reference: `NEFT${r.int(100000, 999999)}`,
      })
      .catch(async () => {
        await world.admin.post('/commissions/payout', {
          commissionIds: list.map((c) => c.id),
          reference: `NEFT${r.int(100000, 999999)}`,
        });
      });
    payouts += 1;
  }
  log(`  ${payouts} broker payouts`);

  // Supplier payments against the stock bought.
  for (const supplier of world.supplier.slice(0, 4)) {
    for (const code of ['KOL', 'HWH']) {
      await world.sessions[BRANCH_ADMIN[code]]
        .post(`/suppliers/${supplier.id}/payments`, {
          branchId: world.branch[code].id,
          amount: money(r.int(40, 160) * 1000),
          paidOn: isoDay(-r.int(0, 10)),
          mode: 'BANK_TRANSFER',
          reference: `UTR${r.int(10000000, 99999999)}`,
        })
        .catch((error) => {
          if (!(error instanceof ApiError) || error.status >= 500) throw error;
        });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
/** A tiny one-page PDF with a line of text, standing in for a scanned document. */
function specimenPdf(title) {
  const text = title.replace(/[()\\]/g, '');
  const stream = `BT /F1 18 Tf 60 760 Td (${text}) Tj ET\nBT /F1 11 Tf 60 730 Td (Specimen document for demonstration only) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function people() {
  log('Leads and follow-ups, customer KYC, staff and attendance');
  const sources = (await world.admin.get('/reference/lead-sources')).map((x) => x.code);

  // ----- Leads -----
  const counts = { KOL: 26, HWH: 12, SLG: 10, DGP: 8 };
  const journeys = [
    ...Array(8).fill([]),
    ...Array(9).fill(['CONTACTED']),
    ...Array(8).fill(['CONTACTED', 'QUALIFIED']),
    ...Array(7).fill(['CONTACTED', 'QUALIFIED', 'QUOTED']),
    ...Array(6).fill(['CONTACTED', 'QUALIFIED', 'QUOTED', 'NEGOTIATION']),
    ...Array(6).fill(['CONTACTED', 'LOST']),
    ...Array(12).fill(['CONTACTED', 'QUALIFIED', 'QUOTED', 'NEGOTIATION', 'WON']),
  ];
  const plan = r.shuffle(journeys);
  let leadNo = 0;
  let won = 0;
  const phones = new Set(world.customer.map((c) => c.phone));
  const newPhone = () => {
    for (;;) {
      const n = `${r.pick(['9', '8', '7'])}${String(r.int(0, 999999999)).padStart(9, '0')}`;
      if (!phones.has(n)) {
        phones.add(n);
        return n;
      }
    }
  };
  for (const [code, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i += 1) {
      const journey = plan[leadNo % plan.length];
      leadNo += 1;
      const owner = r.pick(BRANCH_STAFF[code]);
      const api = world.sessions[owner];
      let lead = await api.post('/leads', {
        name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
        phone: newPhone(),
        source: r.pick(sources),
        interest: r.pick(LEAD_INTERESTS),
        assignedTo: world.user[owner].id,
        note: 'Enquiry taken at the counter',
      });
      await api.post(`/leads/${lead.id}/notes`, {
        body: r.pick([
          'Called back, asked for a price list',
          'Visited the showroom with his brother',
          'Wants to compare with another dealer',
          'Needs finance, will bring documents',
        ]),
      });
      for (const stage of journey) {
        if (stage === 'WON') {
          const converted = await api.post(`/leads/${lead.id}/convert`, {
            rowVersion: lead.rowVersion,
            address: `${r.int(1, 90)}, ${r.pick(AREAS[code])}`,
            stateCode: '19',
          });
          lead = converted.lead ?? converted;
          won += 1;
        } else {
          lead = await api.post(`/leads/${lead.id}/stage`, {
            stage,
            rowVersion: lead.rowVersion,
            ...(stage === 'LOST' ? { note: r.pick(LOST_REASONS) } : {}),
          });
        }
      }
      // Open leads get follow-ups: some late, some due today, some later, some already done.
      if (!journey.includes('LOST') && !journey.includes('WON')) {
        const offsets = r.pick([[-3], [-1], [0], [2], [5], [-2, 4], [1, 7]]);
        for (const days of offsets) {
          const due = new Date(
            Date.now() + days * 86_400_000 + (days === 0 ? 3_600_000 : 0),
          ).toISOString();
          const followup = await api
            .post(`/leads/${lead.id}/followups`, {
              dueAt: due,
              note: r.pick([
                'Call about the quotation',
                'Arrange a test drive',
                'Ask for documents for finance',
                'Check if he decided',
              ]),
            })
            .catch((error) => {
              if (error instanceof ApiError && error.status === 400) return null;
              throw error;
            });
          if (followup && days < 0 && r.chance(0.4))
            await api.post(`/followups/${followup.id}/complete`, {
              note: 'Spoke to him, will come on Saturday',
            });
        }
      }
    }
  }
  log(`  ${leadNo} leads, ${won} converted to customers`);

  // ----- KYC documents for customers who bought vehicles -----
  const buyers = r.shuffle(world.customer.filter((c) => !c.business)).slice(0, 26);
  let verified = 0,
    pending = 0,
    rejected = 0;
  for (const [index, customer] of buyers.entries()) {
    const api = world.sessions[r.pick(BRANCH_STAFF[customer.branch])];
    const upload = async (docType, fileName, number) => {
      const result = await api.request(
        'POST',
        `/customers/${customer.id}/kyc-documents?docType=${docType}&fileName=${fileName}`,
        specimenPdf(`${docType} - ${customer.name}`),
        {
          'Content-Type': 'application/pdf',
          ...(number ? { 'X-Document-Number': number } : {}),
        },
      );
      if (result.status >= 400)
        throw new ApiError('POST', 'kyc-documents', result.status, result.body);
      return result.body;
    };
    const aadhaar = await upload('AADHAAR', 'aadhaar.pdf');
    const second = await upload(
      index % 3 === 0 ? 'DRIVING_LICENCE' : 'PHOTO',
      index % 3 === 0 ? 'licence.pdf' : 'photo.pdf',
    );
    const reviewer = world.sessions[BRANCH_ADMIN[customer.branch]];
    if (index < 16) {
      await reviewer.post(`/customers/${customer.id}/kyc-documents/${aadhaar.id}/verify`, {
        rowVersion: aadhaar.rowVersion,
      });
      await reviewer.post(`/customers/${customer.id}/kyc-documents/${second.id}/verify`, {
        rowVersion: second.rowVersion,
      });
      verified += 2;
    } else if (index < 18) {
      await reviewer.post(`/customers/${customer.id}/kyc-documents/${second.id}/reject`, {
        rowVersion: second.rowVersion,
        reason: 'Photograph is blurred, please upload again',
      });
      rejected += 1;
      pending += 1;
    } else pending += 2;
  }
  log(`  KYC: ${verified} verified, ${rejected} rejected, ${pending} waiting for review`);

  // ----- Staff records, attendance, leave and payroll -----
  let employeeNo = 0;
  const staffIds = {};
  for (const person of USERS) {
    const [designation, department, salary] = STAFF_PAY[person.username];
    const created = await world.admin.post('/staff', {
      userId: world.user[person.username].id,
      branchId: world.branch[person.branches[0]].id,
      employeeCode: `BTM-${String(100 + ++employeeNo)}`,
      department,
      designation,
      joinDate: isoDay(-r.int(120, 900)),
      monthlySalary: money(salary),
    });
    staffIds[person.username] = created;
  }
  const leaves = [
    ['sanjay.das', 3, 'PAID', 'Family function in the village', 'approve'],
    ['moumita.pal', 2, 'PAID', 'Fever, doctor advised rest', 'approve'],
    ['tanmoy.saha', 5, 'UNPAID', 'Personal travel', 'approve'],
    ['rajesh.kar', 2, 'PAID', 'Son’s school admission', 'pending'],
    ['priya.bose', 1, 'PAID', 'Bank work', 'reject'],
    ['kaushik.paul', 4, 'PAID', 'Festival leave', 'pending'],
  ];
  const onLeave = {}; // username -> dates with approved leave, which get no attendance
  for (const [username, days, kind, reason, decision] of leaves) {
    const person = USERS.find((u) => u.username === username);
    const from = decision === 'pending' ? isoDay(r.int(3, 9)) : isoDay(-r.int(10, 30));
    // Leave already taken is recorded by a manager for the staff member; future leave is asked for by the person.
    const dates = {
      fromDate: from,
      toDate: isoDay(days - 1, new Date(`${from}T00:00:00Z`)),
      kind,
      reason,
    };
    const leave =
      decision === 'pending'
        ? await world.sessions[username].post('/leave', dates)
        : await world.sessions[BRANCH_ADMIN[person.branches[0]]].post('/leave', {
            ...dates,
            staffId: staffIds[username].id,
          });
    const approver = world.admin;
    if (decision === 'approve') {
      await approver.post(`/leave/${leave.id}/approve`, {
        rowVersion: leave.rowVersion,
        note: 'Approved',
      });
      for (let d = 0; d < days; d += 1)
        (onLeave[username] ??= new Set()).add(isoDay(d, new Date(`${from}T00:00:00Z`)));
    }
    if (decision === 'reject')
      await approver.post(`/leave/${leave.id}/reject`, {
        rowVersion: leave.rowVersion,
        note: 'Month-end rush, please take another day',
      });
  }

  const today = new Date();
  let marks = 0;
  for (const person of USERS) {
    const staff = staffIds[person.username];
    const admin =
      world.sessions[BRANCH_ADMIN[person.branches[0]]] ?? world.sessions['soumik.dutta'];
    for (let back = 1; back <= 44; back += 1) {
      const day = new Date(today.getTime() - back * 86_400_000);
      if (day.getUTCDay() === 0) continue; // Sunday
      if (r.chance(0.07)) continue; // absent
      const date = isoDay(0, day);
      if (onLeave[person.username]?.has(date)) continue;
      const inMinutes = 9 * 60 + 30 - 330 + r.int(-10, 25);
      const outMinutes = 18 * 60 + 30 - 330 + r.int(-15, 45);
      const at = (m) =>
        `${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00.000Z`;
      await admin
        .put('/attendance/correct', {
          staffId: staff.id,
          workDate: date,
          checkIn: at(inMinutes),
          checkOut: at(outMinutes),
          reason: 'Entered from the muster register',
        })
        .catch(async () => {
          await world.admin.put('/attendance/correct', {
            staffId: staff.id,
            workDate: date,
            checkIn: at(inMinutes),
            checkOut: at(outMinutes),
            reason: 'Entered from the muster register',
          });
        });
      marks += 1;
    }
    // Today's attendance by the person themselves.
    await world.sessions[person.username].post('/attendance/check-in', {}).catch(() => undefined);
  }
  log(`  ${USERS.length} staff records, ${marks} attendance days`);

  // Payroll for last month: finalised for the big branches, still a draft elsewhere.
  const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const month = `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}`;
  let payrolls = 0;
  let finalised = 0;
  for (const code of ['KOL', 'HWH', 'SLG', 'DGP']) {
    await world.admin.post('/payroll/generate', { month, branchId: world.branch[code].id });
    const rows = await world.admin.all(`/payroll?month=${month}&branchId=${world.branch[code].id}`);
    payrolls += rows.length;
    if (code === 'KOL' || code === 'HWH')
      for (const row of rows) {
        await world.admin.post(`/payroll/${row.id}/finalize`, { rowVersion: row.rowVersion });
        finalised += 1;
      }
  }
  log(`  payroll for ${month}: ${payrolls} records, ${finalised} finalised`);
}

const PHASES = { setup, masters, stock, transfers, sales, quotations, afterSales, people };
async function main() {
  const started = Date.now();
  const names = only.length ? only : Object.keys(PHASES);
  for (const name of names) await PHASES[name]();
  log(`Done in ${Math.round((Date.now() - started) / 1000)} s`);
}
main().catch((error) => {
  process.stderr.write(
    `\nDemo seeding stopped: ${error instanceof Error ? error.message : error}\n`,
  );
  process.exit(1);
});
