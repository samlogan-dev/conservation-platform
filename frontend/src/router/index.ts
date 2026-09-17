import { createRouter, createWebHistory } from "vue-router";
import RawDataView from "@/views/RawDataView.vue";

/**
 * The views, in pipeline order: what the source sent, how it is stored, the numbers, what the
 * numbers mean, and what the model makes of them.
 */
const routes = [
  { path: "/", name: "raw", component: RawDataView },
  { path: "/schema", name: "schema", component: () => import("@/views/SchemaView.vue") },
  { path: "/statistics", name: "statistics", component: () => import("@/views/StatisticsView.vue") },
  { path: "/insights", name: "insights", component: () => import("@/views/InsightsView.vue") },
  { path: "/analysis", name: "analysis", component: () => import("@/views/AnalysisView.vue") },
  // The scaffold's users demo, kept reachable so the original wiring check still works.
  { path: "/users", name: "users", component: () => import("@/views/UserView.vue") },
];

const router = createRouter({ history: createWebHistory(), routes });

export default router;
