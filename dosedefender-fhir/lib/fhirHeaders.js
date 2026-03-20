/**
 * Returns Axios headers for FHIR requests.
 * When a SMART access token exists in the Express session, it is forwarded
 * as a Bearer token. Otherwise requests go out unauthenticated (open sandbox).
 */
function getFhirHeaders(req) {
  const headers = { Accept: 'application/fhir+json' };
  if (req?.session?.accessToken) {
    headers.Authorization = `Bearer ${req.session.accessToken}`;
  }
  return headers;
}

module.exports = { getFhirHeaders };
