// case_officer matches the default Entra role value.
export const ACTOR_TYPE = Object.freeze({
  APPLICANT: 'applicant',
  CASE_OFFICER: 'case_officer',
  // A verified external applicant editing their own registration after
  // returning via email verification (not the initial, unauthenticated
  // submission — that stays APPLICANT).
  EXTERNAL_USER: 'external_user'
})
