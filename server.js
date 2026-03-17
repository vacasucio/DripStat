require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const patientRoutes = require('./routes/patient');
const labRoutes = require('./routes/labs');
const medicationRoutes = require('./routes/medications');
const vitalRoutes = require('./routes/vitals');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// FHIR-backed API routes
app.use('/api/patient', patientRoutes);
app.use('/api/labs', labRoutes);
app.use('/api/medications', medicationRoutes);
app.use('/api/vitals', vitalRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', fhirBase: process.env.FHIR_BASE_URL });
});

app.listen(PORT, () => {
  console.log(`DoseSafe server running on http://localhost:${PORT}`);
  console.log(`FHIR base: ${process.env.FHIR_BASE_URL}`);
});
