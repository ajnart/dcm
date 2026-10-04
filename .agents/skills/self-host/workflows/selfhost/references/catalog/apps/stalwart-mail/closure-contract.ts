/** Source-owned administration-only policy; native mail activation is a separate capability. */
export const stalwartRecoveryTransition = {
  serviceId: "stalwart-mail", name: "STALWART_RECOVERY_MODE", from: "1", to: null,
  after: "first-admin-created" as const,
  proof: { stage: "account-verified" as const, attemptedActions: ["stalwart-bootstrap", "stalwart-management-key", "stalwart-management-listener"] },
};
export const stalwartManagementListener = {
  name: "selfhost-management", protocol: "http", bind: { "[::]:8080": true }, useTls: false, tlsImplicit: false,
};
