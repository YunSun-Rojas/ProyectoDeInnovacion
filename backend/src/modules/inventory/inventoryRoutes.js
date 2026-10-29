export function createInventoryRoutes(controller) {
  return [
    { method: 'GET', path: '/api/inventory/reports', handler: controller.reports },
    { method: 'GET', path: '/api/inventory/alerts', handler: controller.alerts },
    { method: 'GET', path: '/api/inventory/physical', handler: controller.physicalList },
    { method: 'POST', path: '/api/inventory/physical', handler: controller.physical },
    { method: 'GET', path: '/api/inventory/commerce', handler: controller.commerceLoad },
    { method: 'POST', path: '/api/inventory/commerce', handler: controller.commerceSave },
    { method: 'GET', path: '/api/inventory', handler: controller.load },
    { method: 'POST', path: '/api/inventory/changes', handler: controller.change },
  ];
}
