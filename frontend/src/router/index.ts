import { createRouter, createWebHistory } from "vue-router";

const routes = [
  { path: "/", name: "report", component: () => import("@/views/ReportView.vue") },
  { path: "/insights/:type", name: "insights", component: () => import("@/views/InsightsView.vue") },
  { path: "/regions", name: "regions", component: () => import("@/views/RegionsView.vue") },
  { path: "/regions/:region", name: "region", component: () => import("@/views/RegionView.vue") },
  // Taxon ids are URLs ("https://biodiversity.org.au/afd/taxa/…"), so the parameter takes slashes.
  { path: "/taxa/:id(.*)", name: "taxon", component: () => import("@/views/TaxonView.vue") },
  { path: "/evaluation", name: "evaluation", component: () => import("@/views/EvaluationView.vue") },
  { path: "/runs/:id", name: "run", component: () => import("@/views/RunView.vue") },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

export default router;
