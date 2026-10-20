export const STATES: readonly (readonly [string, string])[] = [
  ['01', 'Jammu and Kashmir'],
  ['02', 'Himachal Pradesh'],
  ['03', 'Punjab'],
  ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'],
  ['06', 'Haryana'],
  ['07', 'Delhi'],
  ['08', 'Rajasthan'],
  ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'],
  ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'],
  ['13', 'Nagaland'],
  ['14', 'Manipur'],
  ['15', 'Mizoram'],
  ['16', 'Tripura'],
  ['17', 'Meghalaya'],
  ['18', 'Assam'],
  ['19', 'West Bengal'],
  ['20', 'Jharkhand'],
  ['21', 'Odisha'],
  ['22', 'Chhattisgarh'],
  ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['27', 'Maharashtra'],
  ['28', 'Andhra Pradesh (before division)'],
  ['29', 'Karnataka'],
  ['30', 'Goa'],
  ['31', 'Lakshadweep'],
  ['32', 'Kerala'],
  ['33', 'Tamil Nadu'],
  ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'],
  ['37', 'Andhra Pradesh'],
  ['38', 'Ladakh'],
  ['97', 'Other Territory'],
  ['99', 'Centre Jurisdiction'],
];

export const GST_RATES: readonly (readonly [string, string])[] = [
  ['0', 'GST 0% (nil rated)'],
  ['5', 'GST 5%'],
  ['18', 'GST 18%'],
  ['40', 'GST 40%'],
];

export const HSN_CODES: readonly (readonly [string, string, string])[] = [
  ['8703', 'Electrically operated motor vehicles, including e-rickshaws', '5'],
  ['8507', 'Electric accumulators: lead-acid and lithium-ion batteries sold separately', '18'],
  ['8501', 'Electric motors and generators', '18'],
  ['8504', 'Static converters and chargers', '18'],
  ['8708', 'Parts and accessories of motor vehicles', '18'],
  ['4011', 'New pneumatic tyres, of rubber', '18'],
  ['8512', 'Lighting and signalling equipment for vehicles', '18'],
];

export const UNITS: readonly (readonly [string, string])[] = [
  ['PCS', 'Pieces'],
  ['SET', 'Set'],
  ['PAIR', 'Pair'],
  ['KG', 'Kilogram'],
  ['MTR', 'Metre'],
  ['LTR', 'Litre'],
  ['BOX', 'Box'],
];

export const PAYMENT_MODES: readonly (readonly [string, string])[] = [
  ['CASH', 'Cash'],
  ['UPI', 'UPI'],
  ['BANK_TRANSFER', 'Bank transfer'],
  ['CARD', 'Card'],
  ['OTHER', 'Other'],
  ['EXCHANGE', 'Exchange (old unit taken back)'],
];

export const LEAD_SOURCES: readonly (readonly [string, string])[] = [
  ['WALK_IN', 'Walk-in'],
  ['PHONE', 'Phone enquiry'],
  ['REFERRAL', 'Referral'],
  ['BROKER', 'Broker'],
  ['WEBSITE', 'Website'],
  ['SOCIAL_MEDIA', 'Social media'],
  ['EXHIBITION', 'Exhibition or event'],
  ['OTHER', 'Other'],
];

export const KYC_DOCUMENT_TYPES: readonly (readonly [string, string])[] = [
  ['AADHAAR', 'Aadhaar card'],
  ['PAN', 'PAN card'],
  ['VOTER_ID', 'Voter ID'],
  ['DRIVING_LICENCE', 'Driving licence'],
  ['PASSPORT', 'Passport'],
  ['GST_CERTIFICATE', 'GST certificate'],
  ['ADDRESS_PROOF', 'Address proof'],
  ['PHOTO', 'Photograph'],
];

export const DEPARTMENTS: readonly (readonly [string, string])[] = [
  ['SALES', 'Sales'],
  ['STORES', 'Stores and inventory'],
  ['WORKSHOP', 'Workshop and assembly'],
  ['ACCOUNTS', 'Accounts'],
  ['ADMIN', 'Administration'],
];

export interface CategorySeed {
  name: string;
  children?: readonly string[];
}

export const ITEM_CATEGORIES: readonly CategorySeed[] = [
  { name: 'TOTO Vehicles' },
  { name: 'Batteries', children: ['Lead-acid batteries', 'Lithium-ion batteries'] },
  { name: 'Motors and Controllers' },
  { name: 'Chargers' },
  {
    name: 'Spare Parts',
    children: [
      'Tyres and tubes',
      'Body and chassis',
      'Electrical and wiring',
      'Brakes and suspension',
    ],
  },
  { name: 'Accessories' },
];
