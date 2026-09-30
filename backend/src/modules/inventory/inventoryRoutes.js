export function createInventoryRoutes(controller) {
  return [
    { method: 'GET', path: '/api/inventory', handler: controller.load },
    { method: 'POST', path: '/api/inventory/changes', handler: controller.change },
  ];
}
