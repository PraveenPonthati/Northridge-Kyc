# Northbridge Finance — KYC document verification workspace

Team Beta · Runnable local project for a borrower portal, a staff review dashboard, and a document-checking pipeline that runs entirely on your machine.

This package contains no accounts, applications, or uploaded documents. The `data/` folder is created on first run, and everything in `samples/` is synthetic.

## Project preview

<p align="center">
  <img src="https://github.com/user-attachments/assets/24810c46-812d-443f-a887-2c3eb84401c2" width="920" alt="Northbridge borrower portal overview" />
</p>

<div align="center">
  <img src="https://github.com/user-attachments/assets/963196c8-cff8-43b2-b588-a2a4a54e6476" width="260" alt="Borrower portal upload flow" />
  <img src="https://github.com/user-attachments/assets/9f9e0080-30c1-4b2a-9542-46bc7d498219" width="260" alt="Document verification page" />
  <img src="https://github.com/user-attachments/assets/20fc2a24-69d0-4ce6-a003-97ff17bdc736" width="260" alt="Staff review queue" />
  <img src="https://github.com/user-attachments/assets/fc6c61d7-bc3c-496b-950f-a1c27cbf694c" width="260" alt="Application review and decision view" />
</div>

## Quick start

Python 3.12 is required. Run everything from the extracted project folder.

### 1) Setup

- Install Python 3.12
- Install Tesseract OCR if you want the optional fallback engine and Compare tab
- Open a terminal in the project root

### Windows (PowerShell)

```powershell
winget install Python.Python.3.12            # skip if `python --version` already says 3.12
winget install UB-Mannheim.TesseractOCR      # optional: fallback OCR engine and Compare tab
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
python -m backend.seed
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-access-log --reload
```

### macOS / Linux

```bash
brew install tesseract                       # optional (Linux: sudo apt install tesseract-ocr)
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m backend.seed
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-access-log --reload
```

### 2) Open the app

Then open:

- http://127.0.0.1:8000/ — borrower portal (register, or sign in with a seeded account)
- http://127.0.0.1:8000/staff — staff dashboard (not linked from the borrower site)

`python -m backend.seed` creates the development accounts below. It is safe to run again: it only adds what is missing.

| Account | Sign in at | Email | Password |
| --- | --- | --- | --- |
| Staff (credit officer) | `/staff` | `lender@northbridge.test` | `lender-dev-pass-2026` |
| Administrator tests (borrower) | `/` | `admin.tests@northbridge.test` | `admin-tests-pass-2026` |
| Four synthetic borrowers | `/` | `ravi.menon@example.test`, `anil.kumar@example.test`, `meera.iyer@example.test`, `kiran.rao@example.test` | `borrower-dev-pass-2026` |

These are development values defined in `backend/seed.py`. Override them with `NB_SEED_LENDER_EMAIL`, `NB_SEED_LENDER_PASSWORD`, `NB_SEED_BORROWER_PASSWORD`, `NB_SEED_TEST_PASSWORD` and `NB_TEST_BORROWER_EMAIL` in your environment.

### Notes

- The first start downloads RapidOCR's small English model once, so it needs internet; after that the app runs offline.
- No LLM is needed. Extraction uses a labeled-field parser; an LLM is optional (see *Optional LLM extraction*).
- `--reload` restarts the server when code changes. Without it, restart by hand after editing Python files.
- Borrower and staff share one login per browser. To use both at once, open one of them in a private window. `localhost` and `127.0.0.1` count as different sites, so stay on one.
- To start again from empty, stop the server and delete the `data/` folder.

### Alternative: Docker Desktop

```bash
docker compose up --build
```

Docker Compose requires `NB_ENCRYPTION_KEY` (see `compose.yaml`) and binds only to localhost. The Docker configuration is supplied but has not been built in the authoring environment.

## Ten-minute demonstration

1. Sign in at `/` with the **Administrator tests** account. It is a borrower login with one extra button, **Start a new test run**, which opens a fresh application with its own number, so scenarios can be reproduced cleanly.
2. Open `samples/applicant-reference.csv`. It lists 12 fictional applicants: which three files to upload for each (`id_card_file`, `salary_slip_file`, `bank_statement_file`, all in `samples/documents/`) and the expected mismatch pattern.
3. Upload one applicant's files, choose **Submit for verification**, and read the result and its reason. Suggested order: applicant 1 (clean), 3 (same person, messy formatting → still Verified), and then a few mismatch cases.
4. Sign in at `/staff` in a private window. Test runs are listed in the collapsible **Administrator tests** section below the review queue and are not counted in it. Open one to see the document viewer and decision trace.

A verified result plays a short chime with a brief on-screen pop; a mismatch and an incomplete result each have their own sound.

## Backend processing pipeline

Every upload runs the same five stages over the application's current documents. Borrowers see them as a progress rail (stage names, status and a short non-identifying detail); staff also see timings.

| Stage | What happens | Where |
| --- | --- | --- |
| **Secure storage** | File type checked from its bytes; stored encrypted (AES-256-GCM); a new document version is recorded | `store.py`, `portal.py` |
| **Pre-scan** | Sharpness, contrast and brightness of each page | `pipeline.read_document` |
| **PDF text and layout parsing** | PyMuPDF extracts an existing PDF text layer first; local Docling layout parsing is the fallback when classification or required fields are missing. PyMuPDF also renders previews and text boxes for evidence. | `pipeline.py` |
| **OCR** | Local RapidOCR (or Tesseract) reads image uploads; unreadable files fail closed → re-upload prompt | `ocr.py` |
| **PII masking** | Presidio with spaCy NER (`en_core_web_sm`, local) plus Indian ID/phone/account patterns and labeled values. Names, IDs, dates of birth, addresses, phones, account numbers and related values are masked before model use. | `pipeline.py` |
| **LLM evaluation** | When configured and supported fields are missing, DeepSeek V4.1 Flash (OpenRouter, provider data collection denied) or the configured local model reads **masked text only** and fills missing values. | `pipeline.py` |
| **Verification** | Deterministic consistency check across the application's documents → Verified / Mismatch / Incomplete / Not applicable, plus human-review gates. See *What the check compares* below. | `pipeline.py` |

**What the check compares.** An ID card and a salary slip are required. A Mismatch is raised, with each reason named, when any of these disagree:

- the name on the ID card and the name on the salary slip;
- the name on the bank statement (when one is attached) and the name on the ID card;
- the PAN printed on any document and the PAN on the ID card;
- the salary credited on the bank statement and the net pay printed on the salary slip.

Names are compared after normalization: Unicode width, case, punctuation, spacing, courtesy titles (Mr, Mrs, Dr, Shri, Smt …) and word order are ignored, so `Ravi Menon`, `RAVI  MENON`, `Mr. ravi menon`, and `Menon Ravi` all compare equal.

The LLM cannot decide the result: the comparison is exact equality of tokens, as the specification requires. Because the LLM only sees placeholders, it confirms *which* token is the holder's name on each document without changing the final rule.

**Real-world layouts.** Labels are read whether written as `Name: value`, `Name value`, or `Name` with the value on the next line (e.g. `Employee Name` ↵ `Ravi Menon`, `Gross Salary` ↵ `82,000`).

To enable the LLM stage (PowerShell):

```powershell
$env:NB_LLM_PROVIDER = "openrouter"
$env:OPENROUTER_API_KEY = "<your OpenRouter key>"
```

With a remote LLM, residual risk remains: masking is best effort, so a name that neither a label nor NER recognises could be sent in masked text. Review the Masked text tab on real-looking test documents before enabling production use.

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

**Borrower flow.** Uploading only stores the file (encrypted) — nothing is verified yet. Choosing a file first opens a **preview** ("Upload this file" / "Choose another file"); after upload each document is checked and optionally rejected for re-upload.

**Application statuses:** Not submitted → Checking your documents → Action needed (replace flagged documents, then resubmit), Approved (all required documents accepted and the check is Verified using the rules above).

**Application numbers** look like `NB-2611-483920-57`: year and month opened, a random six-digit serial, and two check digits (ISO 7064 MOD 97-10, the scheme IBANs use). Any single mistyped digit, or a mismatched check digit, is rejected.

**Administrator test account.** One borrower login (`NB_TEST_BORROWER_EMAIL`, default `admin.tests@northbridge.test`, created by the seed script) can open a fresh application at any time with **Start a new test run**.

**Automatic re-upload prompts** (per document, shown to the borrower with a plain reason): the file cannot be read; its content is a different document type than its slot (e.g. a salary slip in the ID card slot); or the expected document is missing or invalid.

**Isolation and security**

- Borrower endpoints take no application or document IDs; they always resolve the signed-in borrower's own application. Lender endpoints require the `lender` role. Anything not visible to the caller is withheld.
- Upload links are random, single-use, expire after 10 minutes, are bound to one borrower and one slot, and still require that borrower's session.
- Documents, extraction results and staff notes are encrypted with **AES-256-GCM** (bound to their record) before they are written. SQLite holds metadata only. Key: `NB_ENCRYPTION_KEY` (base64, 32 bytes).
- Sessions: random tokens (stored hashed), HttpOnly, SameSite=Strict cookies; `NB_COOKIE_SECURE=1` behind HTTPS. Every state-changing API call must carry the `x-nb-csrf: 1` header. Passwords use scrypt hashing.
- The audit log records actions and IDs only: uploads, link issues, automatic checks, every lender view of an application, re-upload requests, notes and decisions.
- Borrowers see statuses and reasons only — never confidence scores, masked text, telemetry or internal notes.
- The quick verify tool (`/staff/verify`, `POST /v1/extract`) is limited to signed-in staff. Staff pages live in `staff/`, outside the public `dist/` folder, so the public site cannot serve them.

**Configuration:** `NB_DATA_DIR` (default `./data`), `NB_ENCRYPTION_KEY`, `NB_COOKIE_SECURE`, plus the OCR/LLM variables below. Docker Compose requires `NB_ENCRYPTION_KEY` and stores data in the configured volume.

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

- Responsive, dependency-free HTML/CSS/JavaScript workspace (no frontend build): engine picker and dropzone, a five-stage stepper with timings, a pre-scan quality panel, and a page viewer with PII masking overlays.
- Interface: light and dark themes built on one set of design tokens with an international-orange accent, frosted-glass panels over a slowly moving background, layouts for phone, tablet and desktop, and a clean staff review flow.
- Honest progress: stages show what the backend reported. While a run is in flight every stage reads "waiting for result" with the real elapsed time; nothing advances on a timer. Polling updates only the status that has changed.
- Result sounds, synthesized in the browser (no audio files): a rising chime with a brief pop for Verified, a low falling pair for Mismatch, a soft double tap for Incomplete.
- Upload slots per document type: **ID card** and **Salary slip** (both needed for the name check), **Bank statement** (page 1, optional) and **Other related documents** (up to 2, optional). Drag-and-drop is supported.
- FastAPI `POST /v1/extract`, Pydantic v2 response models, same-origin frontend.
- In-memory PDF first-page layout and text extraction with local Docling; PyMuPDF is retained for rendering previews and locating text on the page. Image uploads and PDF fallback OCR use a local engine.
- Compare tab: re-reads the same uploads with the other engine and shows field-by-field agreement, confidence and OCR time.
- Pillow/OpenCV sharpness, brightness and contrast checks; image orientation corrected using EXIF; bounded 20 MP image input and 2400-pixel PDF renders.
- Microsoft Presidio analyzer/anonymizer with explicit Indian financial recognizers and labeled-field spans. Blank spaCy tokenization avoids runtime model downloads.
- Name normalization per the spec: NFKC, **uppercase, strip punctuation, collapse spaces** (`Ravi Menon.` = `RAVI  MENON`); the comparison key additionally drops courtesy titles and ignores word order.
- Exact token comparison: Verified / Mismatch / Incomplete / Not applicable. Missing names or duplicate ID/salary files cannot verify. A bank statement on its own is Not applicable; attached to an ID card and salary slip it can become Verified or Mismatch.
- Per-field evidence: every field carries `confidence` (OCR word confidence × source factor), `source` (`labeled_parser` / `llm`), and page `boxes`. In the UI, select a field to highlight where it can be found.
- Check diagnostics: name confidence below 0.85, salary confidence below 0.90 (plan §2.2), a value not found on the page, a low-quality OCR scan, an LLM guardrail rejection or a parser/LLM disagreement.
- Optional LLM extraction on masked text only (off by default; see below). Code wins: the labeled parser's values are never replaced, and the LLM cannot change the name result.
- Original field display, masked-text inspection, image redaction overlays, original PDF preview, safe JSON telemetry and metadata-only export.
- No external model calls by default and no document data in browser storage (only the theme choice is kept). The quick verify tool keeps uploads in memory only; the portals store documents **encrypted at rest**.
- 73 automated tests (including application-number check digits and portal tests for auth, isolation, upload links, re-uploads, decisions, encryption at rest, real-world label layouts and the public/staff split).

## Sample documents and reference sheet

`samples/documents/` contains **64 designed synthetic PDFs** built around **12 fictional applicants**. Each applicant has five files: an identity card, an Aadhaar-style card, a PAN-style card, a salary slip and a bank statement.

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

`samples/applicant-reference.csv` is the sheet to explain these from. One row per applicant: true details and PAN, what each document prints, the intended inconsistency in plain words, the file names, and the expected result.

```bash
python -m samples.generate_corpus --verify
```

`samples/documents/manifest.csv` describes each file. `samples/20-document-test-sheet.csv` is a separate, older worksheet generated by `python -m backend.evaluate` (see *Tests and evaluation*).

## Hosted vs local

The private hosted site contains the frontend only. Its four scenarios use clearly labeled synthetic fixtures. Uploads on that site are previewed in the browser and **are not extracted**. It does not store or process real applicant documents.

The same frontend served by FastAPI automatically detects `/v1/health` and sends uploads to the local backend for real extraction. Server responses contain original field values for display to the operator.

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

**Local model with Ollama (nothing leaves the machine).** Install [Ollama](https://ollama.com), pull a model, and point the app at it with a `.env` file in the project folder (settings there are loaded automatically). 

```bash
ollama pull deepseek-r1:1.5b
```

```ini
# .env
NB_LLM_PROVIDER=ollama
NB_LLM_MODEL=deepseek-r1:1.5b
```

Restart the server. The quick verify tool then shows "Parser + LLM", and `/v1/health` reports the model with `external_calls: false`. The model is only called for a document where the parser left a supported field empty.

How it is contained:

1. Only Presidio-masked text is sent, wrapped in `<sanitized_ocr_text>` delimiters (control characters and delimiter spoofing stripped, 8,000-character cap). If any value already in the token vault is seen in the text, it is replaced with a stable placeholder.
2. Output is validated by Pydantic, then guardrails: name, date of birth and ID number must be placeholders that occur in *this* document's masked text; employer must be a placeholder or text present in the same masked text.
3. The LLM only fills fields the labeled parser left empty. Disagreements keep the parser value and force review. The name comparison stays deterministic code.
4. Provider errors are never echoed; the request falls back to parser-only results.
5. For OpenRouter, requests set `provider.data_collection = "deny"`. `/v1/health` reports `external_calls: true` for any non-local endpoint.

Limitation: there is no general NER model (blank spaCy), so a name without a recognised label is **not** masked. With a remote endpoint such a name would leave the machine, and the LLM cannot fill `full_name` in that case.

## API

`GET /v1/health` reports processing capabilities.

`POST /v1/extract` accepts repeated multipart fields named `files`:

```bash
curl -X POST http://127.0.0.1:8000/v1/extract \
  -F 'files=@identity.pdf' \
  -F 'files=@salary.pdf'
```

The batch response includes `request_id`, aggregate `check`, a `documents` array of the specification's extraction contract plus masked text/redaction geometry, and allowlisted telemetry. Bank statements are evaluated only on page 1.

Errors: 413 oversized request/file, 415 unsupported request content type, 422 invalid/unreadable document, 429 another request in progress. Errors never echo filenames, OCR text or parser exceptions.

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

Image tests/evaluation use DejaVu Sans when present (Docker/Linux) and fall back to Arial on macOS/Windows. `python -m backend.evaluate` runs every installed engine and writes `evaluation-results.json` in the project root.

| Synthetic set | RapidOCR | Tesseract |
| --- | --- | --- |
| Clean suite: 16 text PDFs + 4 PNG scans, 12 requests | 100/100 fields · 20/20 types · 12/12 decisions | 100/100 · 20/20 · 12/12 |
| 8 degraded photo-like scans (tilt, blur, uneven light, JPEG q45) | **40/40 fields**, none below review threshold | **35/40 fields** (missed ID-card DOB/ID numbers), none flagged for review |
| Median OCR time per degraded scan (this laptop, CPU) | ~8.6 s | ~0.5 s |

Tesseract's misses were not caught by the confidence gate, which is the main reason RapidOCR is the default. Null fields are included in the field denominator. This is a synthetic smoke benchmark, not a claim that it generalizes to all real-world documents.

Browser QA exercised uploaded photo-like scans end to end with RapidOCR, field highlighting, masking, the engine comparison, and the synthetic samples. Backend integration tests exercise the real extraction pipeline and the portal logic.

`requirements-tested.txt` records the tested Linux environment. It is an environment snapshot, not a portable lockfile. `backend/requirements.txt` is the supported installation manifest.

## Specification coverage and remaining work

| Area | This version | Remaining work |
| --- | --- | --- |
| Frontend | Buildless responsive JavaScript UI | React/Vite or Streamlit migration if mandatory |
| OCR and layout | PyMuPDF text first for digital PDFs; Docling layout parsing when needed; RapidOCR or Tesseract for image uploads and OCR fallback | Calibrate review thresholds on real documents; broader PDF/layout heuristics |
| PII | Presidio patterns + explicit labeled spans, ephemeral map | Full NER, broader multilingual/real-document recognition, adversarial recall evaluation |
| Structuring | Labeled-field parser + optional masked-text LLM (OpenAI-compatible) with token guardrails; per-field confidence and grounding | Local NER for unlabeled names; evaluation with a real model corpus |
| Quality | Blur, contrast, brightness, EXIF orientation | DPI calibration, skew estimation/deskew |
| Poor scans | Fail closed below 40 alphanumeric chars or 60% OCR confidence | Local Qwen vision fallback with validated image redaction |
| Logs | JSON allowlist, stage timings | OpenTelemetry collector/exporter integration |
| Hosting | Private synthetic frontend; real local backend | Secure authenticated Python hosting for real documents |

**Privacy boundary:** PII detection is best effort, not a guarantee that every identifier is detected. Therefore LLM extraction is off by default and, when enabled, receives masked text only; a local model is preferred when sensitive documents are involved.

Raw data exists transiently in application memory and in the operator's browser. Clearing maps/references is logical cleanup; Python cannot guarantee physical zeroization of immutable byte/string copies in memory.

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

`pyproject.toml` mirrors `backend/requirements.txt` for [uv](https://docs.astral.sh/uv/) and sets `exclude-newer`, so newly published package versions are not resolved until the cutoff is moved forward.

## OCR engines

| | RapidOCR (default) | Tesseract |
| --- | --- | --- |
| Models | PP-OCRv6 detector (bundled in the wheel) + PP-OCRv5 English recognizer (~8 MB, fetched once, SHA-256 verified; Docker fetches it at build time) | System binary |
| Output used | Per-word text, score and box | Per-word text, confidence and box |
| Strengths | Photos, tilt, glare, small print | Speed (~15× faster on CPU) |
| Threads | `NB_OCR_THREADS` (default `min(4, CPUs)`) | Tesseract default |

Choose the OCR engine in the UI or with `POST /v1/extract?engine=rapidocr|tesseract` (`auto` = RapidOCR when installed). Digital PDFs use PyMuPDF's embedded text when the required fields are present; otherwise the app falls back to local layout parsing and OCR.

Why the English recognizer: RapidOCR's bundled default recognizer is Chinese-first and drops spaces on degraded English scans (`name:RaviMenon`), which broke label parsing on 6 of 8 degraded scans.

## Fields by document type

| Field | ID card | Salary slip | Bank statement (page 1) |
| --- | --- | --- | --- |
| `full_name` | Full name | Employee name | Account holder (joint/second holder names are masked and dropped) |
| `date_of_birth` | ISO `YYYY-MM-DD` when the printed date parses (day-first); otherwise the printed text | — | — |
| `id_number` | The PAN when one is printed, otherwise another labelled ID number. Masked before any model; shown only on the officer's screen | PAN, when printed (labelled "PAN" in the UI) | PAN, when printed |
| `employer_name` | — | Employer / company | — |
| `monthly_salary` | — | **Gross monthly salary** in rupees, number without commas (`Gross monthly salary`, `Gross pay`, `Gross earnings` labels) | **Salary credit** (net pay credited, first amount on the statement page) |

Account numbers, addresses, phone numbers and nominee names are masked and are never output fields. Bank statements are read on page 1 only.

## Troubleshooting

- **A document is called unreadable instantly.** OCR did not run. RapidOCR downloads its English model on first start; if that fails, the app now falls back to Tesseract automatically (install Tesseract if needed).
- **Changes don't show up.** Python code is loaded once at start: run the server with `--reload`, or stop it (Ctrl+C) and start it again. For page changes, hard-refresh the browser (Ctrl+F5).
- **"Only one usage of each socket address" / port 8000 in use.** Another copy of the server is still running. Stop it, or free the port in PowerShell: `Get-NetTCPConnection -LocalPort 8000 | ForEach-Object { $_ }`
- **An old application still shows its old result.** Stored results change only when documents are resubmitted. Use a new test run, or have staff request a re-upload.
- **Signed out after a refresh.** Borrower and staff share one login per browser; signing in as one replaces the other. Use a private window for the second role, and stay on either `localhost` or `127.0.0.1`.
- **The background does not move.** The interface stops all motion when the operating system asks for reduced motion (Windows: Settings → Accessibility → Visual effects → Animation effects).
- **Salary slip says the name could not be found.** The slip prints the employee name with no label (e.g. only in the header). That case is handled only when the LLM stage is enabled (`NB_LLM_PROVIDER` is not `none`).
