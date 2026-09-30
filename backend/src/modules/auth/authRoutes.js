export function createAuthRoutes(controller) {
  return [
    { method: 'POST', path: '/api/auth/login', public: true, handler: controller.login },
    { method: 'POST', path: '/api/auth/logout', public: true, handler: controller.logout },
    { method: 'GET', path: '/api/auth/session', handler: controller.session },
    { method: 'POST', path: '/api/auth/reauthenticate', handler: controller.reauthenticate },
    { method: 'PATCH', path: '/api/auth/account', handler: controller.updateAccount },
  ];
}
