//apps/web/src/features/billing/invoice-print.tsx
import type { Invoice } from '@erp/contracts';

/**
 * The heading of a printed invoice, in the layout of the business's own printed invoice: what it is in red, the mobile
 * number, the company name in large letters, the proprietor, the GSTIN in a box and the address. It is on the page only
 * when printing; on screen the dialog shows its usual fields.
 */
export function PrintLetterhead({ invoice }: { invoice: Invoice }) {
  const company = invoice.company;
  if (!company) return null;
  const gstin = invoice.type === 'GST' ? (invoice.branchGstin ?? company.gstin) : null;
  return (
    <div className="mb-4 hidden border border-foreground p-3 text-center print:block">
      <div className="flex items-center justify-between text-sm font-bold">
        <span className="text-destructive">
          {invoice.type === 'GST' ? 'GST INVOICE' : 'INVOICE'}
        </span>
        {company.phone ? <span>Mob-{company.phone}</span> : <span />}
      </div>
      <p className="font-serif text-4xl font-bold uppercase tracking-wide">{company.name}</p>
      {company.proprietor ? <p className="font-bold">Prop-{company.proprietor}</p> : null}
      {gstin ? (
        <p className="my-1 inline-block rounded-md border border-foreground px-4 py-0.5 font-bold">
          GST IN: {gstin}
        </p>
      ) : null}
      {company.address ? <p className="text-sm">{company.address}</p> : null}
    </div>
  );
}

/** The foot of a printed invoice: the total in words, the terms, and the signatures. Printed only. */
export function PrintFooter({ invoice }: { invoice: Invoice }) {
  const company = invoice.company;
  if (!company) return null;
  return (
    <div className="mt-6 hidden text-sm font-bold print:block">
      {invoice.totalInWords ? <p>Total Value (in Word)- {invoice.totalInWords}</p> : null}
      {company.terms ? <p className="mt-2">1. {company.terms}</p> : null}
      <div className="mt-12 flex items-end justify-between">
        <span>Customer Signature</span>
        <span>For {company.name.toUpperCase()}</span>
      </div>
    </div>
  );
}
