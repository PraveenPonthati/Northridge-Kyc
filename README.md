# Northbridge Finance — KYC document verification workspace

Team Beta · Runnable local project: a borrower portal, a staff review dashboard and a document-checking pipeline that runs entirely on your machine.

This package contains no accounts, applications or uploaded documents. The `data/` folder is created on first start; everything in `samples/` is synthetic.

## Quick start

Python **3.12** is required. Run everything from the extracted project folder.

**Windows (PowerShell)**

```powershell
winget install Python.Python.3.12            # skip if `python --version` already says 3.12
winget install UB-Mannheim.TesseractOCR      # optional: fallback OCR engine and the Compare tab
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
python -m backend.seed
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-access-log --reload
```

**macOS / Linux**

```bash
brew install tesseract                       # optional (Linux: sudo apt install tesseract-ocr)
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m backend.seed
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-access-log --reload
```

Then open:

- **http://127.0.0.1:8000/** — borrower portal (register, or sign in with a seeded account)
- **http://127.0.0.1:8000/staff** — staff dashboard (not linked from the borrower site)

`python -m backend.seed` creates the development accounts below. It is safe to run again: it only adds what is missing.

| Account | Sign in at | Email | Password |
| --- | --- | --- | --- |
| Staff (credit officer) | `/staff` | `lender@northbridge.test` | `lender-dev-pass-2026` |
| Administrator tests (borrower) | `/` | `admin.tests@northbridge.test` | `admin-tests-pass-2026` |
| Four synthetic borrowers | `/` | `ravi.menon@example.test`, `anil.kumar@example.test`, `meera.iyer@example.test`, `kiran.rao@example.test` | `borrower-dev-pass-2026` |

These are development values defined in `backend/seed.py`. Override them with `NB_SEED_LENDER_EMAIL`, `NB_SEED_LENDER_PASSWORD`, `NB_SEED_BORROWER_PASSWORD`, `NB_SEED_TEST_PASSWORD` and `NB_TEST_BORROWER_EMAIL` before seeding anything that is not a local demo.

Notes:

- The first start downloads RapidOCR's small English model once, so it needs internet; after that the app runs offline.
- No LLM is needed. Extraction uses a labeled-field parser; an LLM is optional (see *Optional LLM extraction*).
- `--reload` restarts the server when code changes. Without it, restart by hand after editing Python files.
- Borrower and staff share one login per browser. To use both at once, open one of them in a private window. `localhost` and `127.0.0.1` count as different sites, so stay on one.
- To start again from empty, stop the server and delete the `data/` folder.

Alternative (Docker Desktop):

```bash
docker compose up --build
```

Docker Compose requires `NB_ENCRYPTION_KEY` (see `compose.yaml`) and binds only to localhost. The Docker configuration is supplied but has not been built in the authoring environment.

## Ten-minute demonstration

1. Sign in at `/` with the **Administrator tests** account. It is a borrower login with one extra button, **Start a new test run**, which opens a fresh application with its own number, so scenarios can be shown back to back without registering new accounts.
2. Open `samples/applicant-reference.csv`. It lists 12 fictional applicants: which three files to upload for each (`id_card_file`, `salary_slip_file`, `bank_statement_file`, all in `samples/documents/`), what was changed on purpose, and the expected result.
3. Upload one applicant's files, choose **Submit for verification**, and read the result and its reason. Suggested order: applicant 1 (clean), 3 (same person, messy formatting → still Verified), 7 (one PAN digit differs), 9 (salary credit differs), 10 (two problems at once).
4. Sign in at `/staff` in a private window. Test runs are listed in the collapsible **Administrator tests** section below the review queue and are not counted in it. Open one to see the document viewer, field highlights, the decision trace and the masked text.

A verified result plays a short chime with a brief on-screen pop; a mismatch and an incomplete result each have their own sound.

## Backend processing pipeline

Every upload runs the same five stages over the application's current documents. Borrowers see them as a progress rail (stage names, status and a short non-identifying detail); staff also see timings.

| Stage | What happens | Where |
| --- | --- | --- |
| **Secure storage** | File type checked from its bytes; stored encrypted (AES-256-GCM); a new document version is recorded | `store.py`, `portal.py` |
| **Pre-scan** | Sharpness, contrast and brightness of each page | `pipeline.read_document` |
| **PDF text and layout parsing** | PyMuPDF extracts an existing PDF text layer first; local Docling layout parsing is the fallback when classification or required fields are missing. PyMuPDF also renders page previews. | `pipeline.py` |
| **OCR** | Local RapidOCR (or Tesseract) reads image uploads; unreadable files fail closed → re-upload prompt | `ocr.py` |
| **PII masking** | Presidio with spaCy NER (`en_core_web_sm`, local) plus Indian ID/phone/account patterns and labeled values. Names, IDs, dates of birth, addresses, phones, account numbers and relatives' names become request-scoped tokens such as `<PERSON_1>` | `pipeline.redact` |
| **LLM evaluation** | When configured and supported fields are missing, DeepSeek V4.1 Flash (OpenRouter, provider data collection denied) or the configured local model reads **masked text only** and may fill parser gaps. Placeholder guardrails discard raw names or foreign tokens; the stage reports failures and empty/rejected output. Skipped when no supported fields are missing or no LLM is configured. | `llm.py`, `pipeline.apply_llm` |
| **Verification** | Deterministic consistency check across the application's documents → Verified / Mismatch / Incomplete / Not applicable, plus human-review gates. See *What the check compares* below. Request token maps are cleared; only sanitized events (counts, timings, statuses) are logged | `pipeline.evaluate`, `review_gate` |

**What the check compares.** An ID card and a salary slip are required. A Mismatch is raised, with each reason named, when any of these disagree:

- the name on the ID card and the name on the salary slip;
- the name on the bank statement (when one is attached) and the name on the ID card;
- the PAN printed on any document and the PAN on the ID card;
- the salary credited on the bank statement and the net pay printed on the salary slip.

Names are compared after normalization: Unicode width, case, punctuation, spacing, courtesy titles (Mr, Mrs, Dr, Shri, Smt …) and word order are ignored, so `Ravi Menon`, `RAVI  MENON`, `Mr. ravi menon` and `MENON, RAVI` are one person. Nothing is guessed: an initial (`R. Menon`), an extra or missing name part, or a different spelling is a mismatch. PANs are compared ignoring case, spaces and dashes.

The LLM cannot decide the result: the comparison is exact equality of tokens, as the specification requires. Because the LLM only sees placeholders, it confirms *which* token is the holder's name on each document; the verification engine compares them.

**Real-world layouts.** Labels are read whether written as `Name: value`, `Name value`, or `Name` with the value on the next line (e.g. `Employee Name` ↵ `Ravi Menon`, `Gross Salary` ↵ `82,000`). Pages laid out in columns are handled: a value stops at the gap before the next column, a row of headings is never read as a value, and dates and ID numbers must contain a digit. Documents are classified by weighted signals (e.g. *payslip*, *gross salary*, *net pay* → salary slip; *statement of … bank*, *opening balance*, *IFSC* → bank statement; *ID number*, *date of birth*, *government* → ID card), so cards that never print "Identity card" or "Aadhaar" are still recognised.

To enable the LLM stage (PowerShell):

```powershell
$env:NB_LLM_PROVIDER = "openrouter"
$env:OPENROUTER_API_KEY = "<your OpenRouter key>"
```

With a remote LLM, residual risk remains: masking is best effort, so a name that neither a label nor NER recognises could be sent in masked text. Review the Masked text tab on real-looking test documents before enabling it for production data.

## Borrower portal and staff dashboard

```
Borrower portal (/)                              Staff dashboard (/staff, unlinked)
1. Register / sign in                            1. Staff sign-in (role: lender)
2. Document slots: ID card, salary slip,         2. Review queue: borrower, application ID,
   bank statement, 2 other documents                status, document check, dates
3. Request a one-time secure upload link  ──►    3. Open an application:
   PUT the file to it ──► encrypted storage         • viewer + field highlights + decision trace
   ──► database ──► automatic OCR check             • request a re-upload (reason shown to borrower)
   validation fails ──► re-upload prompt            • internal notes · approve / reject
Status: Verified · Mismatch · Incomplete ·       History: every document version + audit trail
        Not applicable
```

**Borrower flow.** Uploading only stores the file (encrypted) — nothing is verified yet. Choosing a file first opens a **preview** ("Upload this file" / "Choose another file"); after upload each document shows its filename and a page-1 **thumbnail** that opens a larger view. Before submitting, the borrower can **replace** or **remove** any document. **Submit for verification** runs the full pipeline once on all documents. Before a final staff decision, the borrower can replace any current document and **resubmit**; replacing a document while under review moves the application to **Action needed**.

**Application statuses:** Not submitted → Checking your documents → Action needed (replace flagged documents, then resubmit), Approved (all required documents accepted and the check is Verified using parser/OCR values), or Under review (Mismatch/Incomplete or an LLM-supplied matching name) → Approved / Not approved by staff. A model-supplied name is never enough to auto-approve. While under review the borrower is told which detail disagrees, never that the documents were "verified".

**Application numbers** look like `NB-2611-483920-57`: year and month opened, a random six-digit serial, and two check digits (ISO 7064 MOD 97-10, the scheme IBANs use). Any single mistyped digit, or two neighbouring digits swapped, makes the number invalid. Staff search accepts the number however it is typed (case, spaces, dashes), finds the application in any status, and reports a mistyped number as invalid instead of "no results". Borrowers get a **Copy application number** button. Numbers issued before this scheme (`NB-2026-999205`) still work.

**Administrator test account.** One borrower login (`NB_TEST_BORROWER_EMAIL`, default `admin.tests@northbridge.test`, created by the seed script) can open a fresh application at any time with **Start a new test run**. Its applications are real pipeline runs, but staff see them in a separate collapsible **Administrator tests** section below the queue, and they never count in the queue tiles or filters. No other account can start test runs.

**Automatic re-upload prompts** (per document, shown to the borrower with a plain reason): the file cannot be read; its content is a different document type than its slot (e.g. a salary slip in the ID card slot); a required field is missing (name on the ID card; name and gross salary on the salary slip; account holder on the bank statement). A lender can also request a re-upload with a reason. Re-uploading creates a new version; older versions are kept for the audit trail.

**Isolation and security**

- Borrower endpoints take no application or document IDs; they always resolve the signed-in borrower's own application. Lender endpoints require the `lender` role. Anything not visible to the caller returns **404**.
- Upload links are random, single-use, expire after 10 minutes, are bound to one borrower and one slot, and still require that borrower's session.
- Documents, extraction results and staff notes are encrypted with **AES-256-GCM** (bound to their record) before they are written. SQLite holds metadata only. Key: `NB_ENCRYPTION_KEY` (base64, 32 bytes). Without it a development key file is created in the data folder with a warning — never do that in production.
- Sessions: random tokens (stored hashed), HttpOnly, SameSite=Strict cookies; `NB_COOKIE_SECURE=1` behind HTTPS. Every state-changing API call must carry the `x-nb-csrf: 1` header. Passwords use scrypt; 5 failed sign-ins lock an email for 5 minutes.
- The audit log records actions and IDs only: uploads, link issues, automatic checks, every lender view of an application, re-upload requests, notes and decisions.
- Borrowers see statuses and reasons only — never confidence scores, masked text, telemetry or internal notes.
- The quick verify tool (`/staff/verify`, `POST /v1/extract`) is limited to signed-in staff. Staff pages live in `staff/`, outside the public `dist/` folder, so the public site cannot serve them; a staff account signing in on the borrower page is signed out and told to use the staff sign-in.

**Configuration:** `NB_DATA_DIR` (default `./data`), `NB_ENCRYPTION_KEY`, `NB_COOKIE_SECURE`, plus the OCR/LLM variables below. Docker Compose requires `NB_ENCRYPTION_KEY` and stores data in the `northbridge-data` volume.

**Portal API**

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` · GET `/api/auth/me` | anyone |
| GET | `/api/borrower/application` | borrower (own application only) |
| POST | `/api/borrower/upload-links` `{slot}` → `{upload_url, method: "PUT", expires_in}` | borrower |
| DELETE | `/api/borrower/documents/{slot}` (before submitting) | borrower |
| POST | `/api/borrower/submit` (runs verification) | borrower |
| POST | `/api/borrower/test-runs` (opens a fresh application) | administrator test account only |
| GET | `/api/borrower/documents/{slot}/preview?size=thumb\|large` (page 1 as JPEG, own documents only) | borrower |
| GET | `/api/staff/documents/{id}/preview` (any stored version; audited) | staff |
| PUT | `/api/uploads/{token}` (raw file body) | borrower who owns the link |
| GET | `/api/staff/applications?status=&q=` (returns the queue, `admin_tests` and, for a full application number, `ref_query`) · `/api/staff/applications/{id}` | staff (role `lender`) |
| POST | `/api/staff/applications/{id}/reupload-requests` · `/decision` · `/notes` | staff (role `lender`) |

**Not built yet:** OIDC / single sign-on, staff account management UI, email/SMS notifications, a retention job, field corrections by officers, four-eyes approval.

## Included functionality

- Responsive, dependency-free HTML/CSS/JavaScript workspace (no frontend build): engine picker and dropzone, a five-stage stepper with timings, a pre-scan quality panel, a page viewer with PII masking and field highlights, and an inspector with Fields, Decision (check trace), Masked text, Compare and Telemetry tabs.
- Interface: light and dark themes built on one set of design tokens with an international-orange accent, frosted-glass panels over a slowly moving background, layouts for phone, tablet and desktop, keyboard-operable tabs and dialogs, and reduced-motion support. The chosen theme is remembered in the browser (`localStorage`, key `nb-theme`); nothing else is stored there.
- Honest progress: stages show what the backend reported. While a run is in flight every stage reads "waiting for result" with the real elapsed time; nothing advances on a timer. Polling updates only what changed, retries with backoff after a network failure, and controls cannot be submitted twice.
- Result sounds, synthesized in the browser (no audio files): a rising chime with a brief pop for Verified, a low falling pair for Mismatch, a soft double tap for Incomplete.
- Upload slots per document type: **ID card** and **Salary slip** (both needed for the name check), **Bank statement** (page 1, optional) and **Other related documents** (up to 2, optional). Drag-and-drop or browse per slot, byte-signature checks, 10 MiB/file, 5 files and 50 MiB per request. Every file is classified from its content; if it reads as a different type than its slot, the UI says so and the check uses the detected type.
- FastAPI `POST /v1/extract`, Pydantic v2 response models, same-origin frontend.
- In-memory PDF first-page layout and text extraction with local Docling; PyMuPDF is retained for rendering previews and locating text on the page. Image uploads and PDF fallback OCR use a local engine chosen per request (`?engine=auto|rapidocr|tesseract`): **RapidOCR** or **Tesseract** (piped over stdin/stdout). Neither sends document content to a remote service.
- Compare tab: re-reads the same uploads with the other engine and shows field-by-field agreement, confidence and OCR time.
- Pillow/OpenCV sharpness, brightness and contrast checks; image orientation corrected using EXIF; bounded 20 MP image input and 2400-pixel PDF renders.
- Microsoft Presidio analyzer/anonymizer with explicit Indian financial recognizers and labeled-field spans. Blank spaCy tokenization avoids runtime model downloads.
- Name normalization per the spec: NFKC, **uppercase, strip punctuation, collapse spaces** (`Ravi Menon.` = `RAVI  MENON`); the comparison key additionally drops courtesy titles and ignores word order. Request-local PERSON and ID tokens built on those keys are shared across files, so documents are compared without sending raw values. Maps clear in `finally` even on failures.
- Exact token comparison: Verified / Mismatch / Incomplete / Not applicable. Missing names or duplicate ID/salary files cannot verify. A bank statement on its own is Not applicable; attached to an ID card and salary slip, its name, PAN and salary credit must agree with them.
- Per-field evidence: every field carries `confidence` (OCR word confidence × source factor), `source` (`labeled_parser` / `llm`), and page `boxes`. In the UI, select a field to highlight where it came from (PDF page 1 is rendered for this).
- Check diagnostics: name confidence below 0.85, salary confidence below 0.90 (plan §2.2), a value not found on the page, a low-quality OCR scan, an LLM guardrail rejection or a parser/LLM disagreement is recorded in `check.review_required` and non-PII `review_reasons`. The lender portal auto-approves complete applications with a Verified parser/OCR name match; Mismatch, Incomplete and LLM-supplied name matches stay in review.
- Optional LLM extraction on masked text only (off by default; see below). Code wins: the labeled parser's values are never replaced, and the LLM cannot change the name result.
- Original field display, masked-text inspection, image redaction overlays, original PDF preview, safe JSON telemetry and metadata-only export.
- No external model calls by default and no document data in browser storage (only the theme choice is kept). The quick verify tool keeps uploads in memory only; the portals store documents **encrypted** (see below). No original filenames or document content in logs.
- 73 automated tests (including application-number check digits and portal tests for auth, isolation, upload links, re-uploads, decisions, encryption at rest, real-world label layouts and the public/staff split) (offline; LLM tests use mock/fake providers; image OCR tested on both engines) and a reproducible 20-document synthetic evaluation.

## Sample documents and reference sheet

`samples/documents/` contains **64 designed synthetic PDFs** built around **12 fictional applicants**. Each applicant has five files: an identity card, an Aadhaar-style card, a PAN-style card, a salary slip and a bank statement first page (plus four alternate-layout variants). Every page carries a visible synthetic-sample label; identity samples are marked invalid and omit seals and security features. PANs are invented: PAN-shaped (five letters, four digits, one letter) so the parser is exercised, but assigned to nobody.

Five applicants are **clean** and seven carry a **deliberate inconsistency**:

| # | Applicant | Scenario | What differs |
| --- | --- | --- | --- |
| 1 | Ravi Menon | Clean | nothing |
| 2 | Meera Iyer | Clean | capitals on the slip, lower case on the bank statement |
| 3 | Kiran Rao | Clean | title and double space; surname first; PAN in lower case with spaces |
| 4 | Asha Nair | Clean | inverted capitals; PAN written with dashes |
| 11 | Kabir Jain | Clean | three different capitalisations |
| 5 | Anil Kumar | Mismatch | salary slip in a different name |
| 6 | Leela Shah | Mismatch | bank statement shortens the first name to an initial |
| 7 | Dev Patel | Mismatch | one PAN digit differs on the salary slip |
| 8 | Nina Das | Mismatch | two PAN digits swapped on the bank statement |
| 9 | Arjun Sen | Mismatch | salary credit is INR 6,500 below the net pay |
| 10 | Maya Roy | Mismatch | extra surname on the slip and a different PAN on the bank statement |
| 12 | Tara Bose | Mismatch | one-letter spelling difference on the slip |

`samples/applicant-reference.csv` is the sheet to explain these from. One row per applicant: true details and PAN, what each document prints, the intended inconsistency in plain words, the file names, the expected result, and the pipeline's actual result and reason. All inconsistencies are declared in one list (`APPLICANTS`) at the top of `samples/generate_corpus.py`. To rebuild the PDFs and refill the result columns from the real pipeline:

```bash
python -m samples.generate_corpus --verify
```

`samples/documents/manifest.csv` describes each file. `samples/20-document-test-sheet.csv` is a separate, older worksheet generated by `python -m backend.evaluate` (see *Tests and evaluation*).

## Hosted vs local

The private hosted site contains the frontend only. Its four scenarios use clearly labeled synthetic fixtures. Uploads on that site are previewed in the browser and **are not extracted**. It does not connect from a remote site to localhost.

The same frontend served by FastAPI automatically detects `/v1/health` and sends uploads to the local backend for real extraction. Server responses contain original field values for display to the operator; they must never be sent to shared logs or exposed through a public reverse proxy.

## Optional LLM extraction (masked text only)

| Variable | Default | Notes |
| --- | --- | --- |
| `NB_LLM_PROVIDER` | `none` | `none` · **`ollama`** (a model on this machine) · `openrouter` (DeepSeek V4.1 Flash) · `openai_compatible` · `mock` (offline) |
| `NB_LLM_THINK` | `auto` | `auto` gives reasoning models (DeepSeek-R1, QwQ) room to think before answering; `on` / `off` force it. |
| `OPENROUTER_API_KEY` | — | Required for `openrouter`. Model defaults to `deepseek/deepseek-v4.1-flash` (override with `NB_LLM_MODEL`). |
| `NB_LLM_BASE_URL` | — | e.g. `http://127.0.0.1:11434/v1` (Ollama). Prefer a local endpoint. |
| `NB_LLM_MODEL` | — | Model name at that endpoint. |
| `NB_LLM_API_KEY` | — | Only if the endpoint needs one. |
| `NB_LLM_TIMEOUT_S` | `30` | |
| `NB_SALARY_CONFIDENCE_MIN` / `NB_NAME_CONFIDENCE_MIN` | `0.90` / `0.85` | Review thresholds. |

**Local model with Ollama (nothing leaves the machine).** Install [Ollama](https://ollama.com), pull a model, and point the app at it with a `.env` file in the project folder (settings there are loaded at start; real environment variables win):

```bash
ollama pull deepseek-r1:1.5b
```

```ini
# .env
NB_LLM_PROVIDER=ollama
NB_LLM_MODEL=deepseek-r1:1.5b
```

Restart the server. The quick verify tool then shows "Parser + LLM", and `/v1/health` reports the model with `external_calls: false`. The model is only called for a document where the parser left a supported field empty (for example a salary slip that prints the employee name with no label); on the bundled sample documents the parser finds everything, so the stage reads "not needed". A name supplied by the model never auto-approves an application: it goes to staff for confirmation. Small models guess: `deepseek-r1:1.5b` typically returns the right name placeholder and an invented employer, which the guardrail discards and flags for review.

How it is contained:

1. Only Presidio-masked text is sent, wrapped in `<sanitized_ocr_text>` delimiters (control characters and delimiter spoofing stripped, 8,000-character cap). If any value already in the token vault is still visible, the call is skipped.
2. Output is validated by Pydantic, then guardrails: name, date of birth and ID number must be placeholders that occur in *this* document's masked text; employer must be a placeholder or text present on the page; salary must be a number present on the page. Anything else is discarded and forces review.
3. The LLM only fills fields the labeled parser left empty. Disagreements keep the parser value and force review. The name comparison stays deterministic code.
4. Provider errors are never echoed; the request falls back to parser-only results.
5. For OpenRouter, requests set `provider.data_collection = "deny"`. `/v1/health` reports `external_calls: true` for any non-local endpoint.

Limitation: there is no general NER model (blank spaCy), so a name without a recognised label is **not** masked. With a remote endpoint such a name would leave the machine, and the LLM cannot fill `full_name` from it (raw names are rejected). Use a local endpoint, or add a locally installed spaCy NER model, before relying on LLM name extraction.

## API

`GET /v1/health` reports processing capabilities.

`POST /v1/extract` accepts repeated multipart fields named `files`:

```bash
curl -X POST http://127.0.0.1:8000/v1/extract \
  -F 'files=@identity.pdf' \
  -F 'files=@salary.pdf'
```

The batch response includes `request_id`, aggregate `check`, a `documents` array of the specification's extraction contract plus masked text/redaction geometry, and allowlisted telemetry. Bank statements receive a per-document Not applicable status; an ID + salary pair can still be compared if a bank statement is attached.

Errors: 413 oversized request/file, 415 unsupported request content type, 422 invalid/unreadable document, 429 another request in progress. Errors never echo filenames, OCR text or parser exceptions. The frontend handles these without retaining partial results.

For predictable extraction, use labeled fields such as:

```text
IDENTITY CARD
Full name: Ravi Menon
Date of birth: 14/08/1994
ID number: ABCDE1234F
```

```text
SALARY SLIP
Employee name: Ravi Menon
Employer: Harbour Tools Pvt Ltd
Gross monthly salary: INR 82,000.00
```

The document must have at least 40 alphanumeric characters. These values are synthetic examples. English printed documents are supported; arbitrary layouts and multilingual handwriting are not validated.

## Tests and evaluation

```bash
python -m pytest backend/tests -q
python -m backend.evaluate
```

Image tests/evaluation use DejaVu Sans when present (Docker/Linux) and fall back to Arial on macOS/Windows. `python -m backend.evaluate` runs every installed engine and writes `evaluation-results.json` and `samples/20-document-test-sheet.csv`. Run `python -m samples.generate_corpus` to rebuild the 64 synthetic PDFs:

| Synthetic set | RapidOCR | Tesseract |
| --- | --- | --- |
| Clean suite: 16 text PDFs + 4 PNG scans, 12 requests | 100/100 fields · 20/20 types · 12/12 decisions | 100/100 · 20/20 · 12/12 |
| 8 degraded photo-like scans (tilt, blur, uneven light, JPEG q45) | **40/40 fields**, none below review threshold | **35/40 fields** (missed ID-card DOB/ID numbers), none flagged for review |
| Median OCR time per degraded scan (this laptop, CPU) | ~8.6 s | ~0.5 s |

Tesseract's misses were not caught by the confidence gate, which is the main reason RapidOCR is the default. Null fields are included in the field denominator. This is a synthetic smoke benchmark, not an independently annotated real-document evaluation.

Browser QA exercised uploaded photo-like scans end to end with RapidOCR, field highlighting, masking, the engine comparison, and the synthetic samples. Backend integration tests exercise the real extraction endpoint, corrupt inputs, safe audit logging and image OCR.

`requirements-tested.txt` records the tested Linux environment. It is an environment snapshot, not a portable lockfile. `backend/requirements.txt` is the supported installation manifest.

## Specification coverage and remaining work

| Area | This version | Remaining work |
| --- | --- | --- |
| Frontend | Buildless responsive JavaScript UI | React/Vite or Streamlit migration if mandatory |
| OCR and layout | PyMuPDF text first for digital PDFs; Docling layout parsing when needed; RapidOCR or Tesseract for image uploads and OCR fallback | Calibrate review thresholds on real documents; layout/table extraction for multi-page statements |
| PII | Presidio patterns + explicit labeled spans, ephemeral map | Full NER, broader multilingual/real-document recognition, adversarial recall evaluation |
| Structuring | Labeled-field parser + optional masked-text LLM (OpenAI-compatible) with token guardrails; per-field confidence and grounding | Local NER for unlabeled names; evaluation with a real model |
| Quality | Blur, contrast, brightness, EXIF orientation | DPI calibration, skew estimation/deskew |
| Poor scans | Fail closed below 40 alphanumeric chars or 60% OCR confidence | Local Qwen vision fallback with validated image redaction |
| Logs | JSON allowlist, stage timings | OpenTelemetry collector/exporter integration |
| Hosting | Private synthetic frontend; real local backend | Secure authenticated Python hosting for real documents |

**Privacy boundary:** PII detection is best effort, not a guarantee that every identifier is detected. Therefore LLM extraction is off by default and, when enabled, receives masked text only; a local endpoint is recommended. No vision egress exists. Masked-text UI may still contain unrecognized PII; exports omit OCR text and all field values. Word-box overlays are review aids, not certified irreversible image redaction. After processing, PDF page 1 is shown as a server render (returned to the operator only; never logged or exported). No images are sent to an external vision service.

Raw data exists transiently in application memory and in the operator's browser. Clearing maps/references is logical cleanup; Python cannot guarantee physical zeroization of immutable byte/string copies, OS swap or process memory dumps. Do not deploy this local-only service publicly without authentication, access controls and a reviewed operational data policy. The name result is a consistency check, not identity authentication, fraud certification or a lending decision.

## Source map

- `dist/` — borrower portal and shared assets: `index.html`, `apply.js`, `common.js` (API, rendering, dialogs, sounds), `theme.js`, `styles.css` (design tokens and every component).
- `staff/` — staff pages, served only at `/staff`: `lender.html` + `lender.js` (queue), `verify.html` + `app.js` (quick verify and stored-application review).
- `backend/app.py` — bounded in-memory intake, HTTP endpoints and response headers.
- `backend/portal.py` — accounts, sessions, applications, application numbers, upload links, the check worker, staff queue and decisions.
- `backend/store.py` — SQLite metadata and AES-256-GCM encrypted storage.
- `backend/seed.py` — development accounts, including the administrator test account.
- `backend/pipeline.py` — OCR, quality checks, recognizers, token vault, field parsing and the cross-document check.
- `samples/` — synthetic documents, their generator and `applicant-reference.csv`.
- `backend/models.py` — typed data contracts.
- `backend/tests/` — automated checks.
- `backend/evaluate.py` — reproducible synthetic benchmark.
- `Dockerfile`, `compose.yaml` — isolated local deployment.

## Supply chain

`pyproject.toml` mirrors `backend/requirements.txt` for [uv](https://docs.astral.sh/uv/) and sets `exclude-newer`, so newly published package versions are not resolved until the cutoff is moved forward deliberately. `uv.lock` was resolved under that cutoff. `uv sync && uv run pytest backend/tests -q` uses it.

## OCR engines

| | RapidOCR (default) | Tesseract |
| --- | --- | --- |
| Models | PP-OCRv6 detector (bundled in the wheel) + PP-OCRv5 English recognizer (~8 MB, fetched once, SHA-256 verified; Docker fetches it at build time) | System binary |
| Output used | Per-word text, score and box | Per-word text, confidence and box |
| Strengths | Photos, tilt, glare, small print | Speed (~15× faster on CPU) |
| Threads | `NB_OCR_THREADS` (default `min(4, CPUs)`) | Tesseract default |

Choose the OCR engine in the UI or with `POST /v1/extract?engine=rapidocr|tesseract` (`auto` = RapidOCR when installed). Digital PDFs use PyMuPDF's embedded text when the required fields are present; Docling's local layout model is reserved for PDFs where that fast path is insufficient. The review thresholds (0.85 name, 0.90 salary) still need calibration on real photographed documents.

Why the English recognizer: RapidOCR's bundled default recognizer is Chinese-first and drops spaces on degraded English scans (`name:RaviMenon`), which broke label parsing on 6 of 8 degraded scans. The first local start downloads the English model once from ModelScope; after that RapidOCR runs offline.

## Fields by document type

| Field | ID card | Salary slip | Bank statement (page 1) |
| --- | --- | --- | --- |
| `full_name` | Full name | Employee name | Account holder (joint/second holder names are masked and dropped) |
| `date_of_birth` | ISO `YYYY-MM-DD` when the printed date parses (day-first); otherwise the printed text | — | — |
| `id_number` | The PAN when one is printed, otherwise another labelled ID number. Masked before any model; shown only on the officer's screen | PAN, when printed (labelled "PAN" in the UI) | PAN, when printed |
| `employer_name` | — | Employer / company | — |
| `monthly_salary` | — | **Gross monthly salary** in rupees, number without commas (`Gross monthly salary`, `Gross pay`, `Gross earnings` labels) | **Salary credit** (net pay credited, first amount after "salary" on a credit line). Labelled "Salary credit (net)" in the UI. |

Account numbers, addresses, phone numbers and nominee names are masked and are never output fields. Bank statements are read on page 1 only.

## Troubleshooting

- **A document is called unreadable instantly.** OCR did not run. RapidOCR downloads its English model on first start; if that fails, the app now falls back to Tesseract automatically (install Tesseract, or check `/v1/health` → `ocr_engines`).
- **Changes don't show up.** Python code is loaded once at start: run the server with `--reload`, or stop it (Ctrl+C) and start it again. For page changes, hard-refresh the browser (Ctrl+F5).
- **"Only one usage of each socket address" / port 8000 in use.** Another copy of the server is still running. Stop it, or free the port in PowerShell: `Get-NetTCPConnection -LocalPort 8000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`.
- **An old application still shows its old result.** Stored results change only when documents are resubmitted. Use a new test run, or have staff request a re-upload.
- **Signed out after a refresh.** Borrower and staff share one login per browser; signing in as one replaces the other. Use a private window for the second role, and stay on either `localhost` or `127.0.0.1`.
- **The background does not move.** The interface stops all motion when the operating system asks for reduced motion (Windows: Settings → Accessibility → Visual effects → Animation effects).
- **Salary slip says the name could not be found.** The slip prints the employee name with no label (e.g. only in the header). That case is handled only when the LLM stage is enabled (`NB_LLM_PROVIDER=openrouter`).
