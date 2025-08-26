import { defineDashboardExtension } from "@vendure/dashboard";

export default defineDashboardExtension({
  // Let's add a simple test page to check things are working
  routes: [
    {
      component: () => <div>Test Page Works!</div>,
      path: "/test",
      navMenuItem: {
        id: "test",
        title: "Test Page",
        sectionId: "catalog",
      },
    },
  ],
});
