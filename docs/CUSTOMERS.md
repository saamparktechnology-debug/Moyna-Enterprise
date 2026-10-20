# Customers and KYC (Stage 4, module 4.6)

Screen: **Customers** (`/customers`). Permissions: `customers.view` (list), `customers.manage` (create and edit), `kyc.view` (see documents and open files), `kyc.upload` (upload) and `kyc.verify` (verify or reject, a manager permission). There is no new permission.

## Customers

- Customers belong to the company, not to a branch: every branch sees the same customer.
- A **phone number** is a 10-digit mobile number starting with 6 to 9 and belongs to one customer only; a **GSTIN** (optional) must be valid, match the chosen state, and belong to one customer only. A duplicate is refused with a message that names the customer who already has it. This is what lets the lead module (4.9) convert a lead without creating a second customer.
- Edits send the `rowVersion` they read; a stale version, or two edits at the same moment, lets only one win. An edit that changes nothing is not audited.

## KYC documents

Kinds come from the document-type list (Aadhaar, PAN, voter ID, driving licence, passport, GST certificate, address proof, photograph).

- **Upload**: the file is the request body (`POST /customers/:id/kyc-documents?docType=&fileName=`), a PDF, JPEG or PNG up to **5 MB**. The server checks what the file really is from its first bytes and refuses anything else, whatever the name or the declared type says; it also refuses a declared type that does not match the file. File names with slashes or control characters are refused.
- **Masked numbers**: the optional document number travels in the `X-Document-Number` header, which is not logged. It is checked for its kind (Aadhaar 12 digits, PAN 5 letters, 4 digits, 1 letter, others 4 to 20 letters, digits, dashes or slashes), and only the **last four letters or digits** are kept, as `XXXXXXXX9012`. The full number is never stored, returned, audited or logged, and the database refuses any value that is not masked.
- **Access logging**: every time a file is opened (`GET .../file`) the audit trail records who opened it and which document (`KYC_DOCUMENT_VIEWED`). The file is served with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and as an attachment.
- **Storage**: files go through the storage service under `kyc/<customer>/<random name>`, kept on disk (see _Where files are kept_ below). If the database work fails after the file was stored, the file is removed.

## Status workflow and history

A document starts **waiting for review**. A reviewer verifies it or rejects it with a reason; a decision is final (the database refuses a second decision and any change to the file's details). A **rejected document is replaced by a new upload**, never edited, so the history keeps every attempt, with who uploaded it, who decided, when and why. Uploading a kind that is already waiting replaces the waiting one (it is rejected as "Replaced by a newer upload"); a kind that is already verified is refused. Documents cannot be deleted.

The customer's KYC status follows the latest document of each kind:

| Status             | When                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Not submitted      | no documents                                                                                         |
| Waiting for review | any latest document waits, or only a photo, address proof or GST certificate is verified             |
| Verified           | an identity document (Aadhaar, PAN, voter ID, driving licence or passport) is verified, none waiting |
| Rejected           | nothing is verified and a latest document was rejected                                               |

Nobody verifies a document they uploaded, except a Super Admin. Two uploads or two decisions at the same moment are serialized on the customer, so exactly one waiting document remains.

## Endpoints

| Method and path                                                       | Permission         |
| --------------------------------------------------------------------- | ------------------ |
| `GET /customers`, `GET /customers/:id`                                | `customers.view`   |
| `POST /customers`, `PATCH /customers/:id`                             | `customers.manage` |
| `GET /customers/:id/kyc`, `GET /customers/:id/kyc-documents/:id/file` | `kyc.view`         |
| `POST /customers/:id/kyc-documents`                                   | `kyc.upload`       |
| `POST /customers/:id/kyc-documents/:id/verify`, `/reject`             | `kyc.verify`       |
| `GET /reference/kyc-document-types`                                   | any signed-in user |

## Migration 11 (`20261007001100_customers_kyc`)

Phone and name checks, unique phone and GSTIN indexes on customers; file name, type, size, masked number and review columns on `kyc_documents` with checks that make impossible rows unrepresentable; a trigger that freezes uploaded details and decided documents; and `DELETE` taken away from the application role.

## Not done here

## Where files are kept

KYC files are kept on the server's disk, in the folder named by `KYC_STORAGE_PATH`, so they survive restarts and deployments.

- **Setting**: `KYC_STORAGE_PATH` must be an absolute folder outside the application folder, for example `/var/lib/my-erp/kyc` on Linux or `D:\my-erp-data\kyc` on Windows Server. It is required when `NODE_ENV=production`; the API refuses to start without it, and refuses `STORAGE_DRIVER=memory`. In development, with no path set, files go to `.my-erp/kyc` in the user's home folder. In tests the default is in memory.
- **Start-up check**: the API creates the folder and writes a test file; if that fails, it stops with a message naming the folder.
- **Safety**: the file name is made by the server (`kyc/<customer id>/<uuid>.<pdf|jpg|png>`); keys are checked by shape and by resolved path, so nothing can point outside the folder. Files are written under a temporary name, flushed and renamed, so an interrupted upload leaves no half file. Files and folders are readable by the API's user only (mode 600 and 700 on Linux). The folder is never served directly; every read goes through the API and is access-logged.
- **Missing file**: if a file has gone from disk but its record remains, the download answers 404 and the record is kept.
- **Backup**: back up the folder together with the database, from the same moment if possible. A database restore without the files leaves records that point at nothing; files without the database cannot be tied to a customer.
- **Deployment**: do not put the folder inside the release folder or any folder a deployment replaces. Give the API's user (and nobody else) read and write access. With several API servers, they must share the folder (a network disk); local disks are for one server.
- **Later, S3-compatible storage**: the module uses only the `StorageService` interface (`put`, `get`, `delete`). An S3 or MinIO class can be added and chosen in `storage.factory.ts` with a new `STORAGE_DRIVER` value. To move existing files, copy the folder's contents to the bucket keeping the same keys (the path below the folder), then switch the driver; the database needs no change because it stores only the key. No S3 adapter exists yet and none has been tested.
- **Limit**: the content type is taken from the file extension the server chose; the database holds the type that was checked at upload.
