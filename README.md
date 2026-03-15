# DoseSafe — Clinical Dosing Calculator

Node.js/Express backend that bridges the **Cerner FHIR R4 open sandbox** to the DoseSafe frontend, providing structured patient data for pharmacy dosing calculators.

## FHIR Sandbox

**Base URL:** `https://fhir-open.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d`

No authentication required for this open sandbox. Use a valid Cerner patient ID (e.g., `12724066`) when making requests.

---

## Setup

```bash
# Install dependencies
npm install

# Copy env template and configure
cp .env.example .env

# Start server (production)
npm start

# Start server (development, auto-reload)
npm run dev
```

Open `http://localhost:3000` to load **DoseSafe.html**.

---

## API Endpoints

All endpoints return JSON. Replace `:patientId` with a Cerner patient ID.

### Health Check
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server + FHIR config status |

### Patient Demographics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/patient/:id` | Name, gender, DOB, age, latest weight & height |

**Response fields:** `patientId`, `name`, `gender`, `dateOfBirth`, `age`, `weight { value, unit, date }`, `height { value, unit, date }`

### Lab Results
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/labs/:patientId` | All labs (latest SCr, PTT, BUN + last 5 vancomycin troughs) |
| GET | `/api/labs/:patientId/scr` | Serum creatinine (SCr) — LOINC 2160-0 |
| GET | `/api/labs/:patientId/ptt` | PTT / aPTT — LOINC 3173-2 |
| GET | `/api/labs/:patientId/vancomycin` | Vancomycin trough levels — LOINC 4084-1 |
| GET | `/api/labs/:patientId/bun` | BUN (blood urea nitrogen) — LOINC 3094-0 |

Query params: `?count=10` on `/vancomycin` to control history depth (max 50).

**Response fields per observation:** `id`, `date`, `status`, `value`, `unit`, `interpretation`, `referenceRange { low, high, unit }`

### Medications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/medications/:patientId` | Current medication list with doses & frequencies |
| GET | `/api/medications/:patientId/:id` | Single MedicationRequest by ID |

Query params: `?status=active` (default), `?status=stopped`, `?count=50`

**Response fields per medication:** `id`, `status`, `intent`, `medicationName`, `authoredOn`, `requester`, `dosages [{ text, route, doseQuantity, frequency, timing }]`, `note`

### Vital Signs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/vitals/:patientId` | Latest snapshot: weight, height, temp, HR, RR, SpO2 |
| GET | `/api/vitals/:patientId/weight` | Weight trend + stats (min/max/avg) for dosing |
| GET | `/api/vitals/:patientId/bp` | Blood pressure trend |

Query params: `?count=30` on weight/bp to control history depth (max 100).

---

## LOINC Codes Used

| Lab / Vital | LOINC Code |
|-------------|------------|
| Serum Creatinine (SCr) | 2160-0 |
| aPTT / PTT | 3173-2 |
| Vancomycin trough | 4084-1 |
| BUN | 3094-0 |
| Body weight | 29463-7 |
| Body height | 8302-2 |
| Heart rate | 8867-4 |
| Respiratory rate | 9279-1 |
| SpO2 (pulse ox) | 59408-5 |
| Body temperature | 8310-5 |
| Blood pressure (panel) | 55284-4 |

---

## Project Structure

```
dosafy/
├── server.js              # Express entry point
├── routes/
│   ├── patient.js         # Demographics endpoint
│   ├── labs.js            # Lab results endpoints
│   ├── medications.js     # Medication list endpoints
│   └── vitals.js          # Vital signs endpoints
├── DoseSafe.html          # Frontend application
├── .env                   # Local environment (git-ignored)
├── .env.example           # Environment template
├── package.json
└── README.md
```

---

## Example Requests

```bash
# Patient demographics
curl http://localhost:3000/api/patient/12724066

# All labs at once
curl http://localhost:3000/api/labs/12724066

# Vancomycin troughs (last 10)
curl http://localhost:3000/api/labs/12724066/vancomycin?count=10

# Active medications
curl http://localhost:3000/api/medications/12724066

# Weight trend (last 15 readings)
curl http://localhost:3000/api/vitals/12724066/weight?count=15
```

---

## Clinical Disclaimer

This tool is intended for **educational and demonstration purposes only** using a publicly available open sandbox. It must not be used for actual clinical decision-making without proper validation, credentialing, and regulatory compliance.
