import { createRouter, createWebHistory } from "vue-router";
import PortalLayout from "@/layouts/PortalLayout.vue";
import OverviewView from "@/views/portal/OverviewView.vue";

/**
 * Two surfaces, one app.
 *
 * The portal, at `/`, is for the practitioner: the current picture per species and region,
 * with the sources merged into one corpus and every figure naming the runs it came from. It
 * reads only.
 *
 * The console, at `/console`, is for the researcher and the examiner: one run at a time, in
 * pipeline order — what the source sent, how it is stored, how the fetch went, how the
 * sources compare — plus the two
 * things that act: starting a harvest, and generating the AI analysis the portal displays.
 */
const routes = [
  {
    path: "/",
    component: PortalLayout,
    children: [
      { path: "", name: "overview", component: OverviewView },
      { path: "sources", name: "sources", component: () => import("@/views/portal/SourcesView.vue") },
      { path: "analysis", name: "analysis", component: () => import("@/views/portal/AnalysisView.vue") },
    ],
  },
  {
    path: "/console",
    component: () => import("@/layouts/ConsoleLayout.vue"),
    children: [
      { path: "", name: "console-raw", component: () => import("@/views/console/RawDataView.vue") },
      { path: "schema", name: "console-schema", component: () => import("@/views/console/SchemaView.vue") },
      { path: "harvest", name: "console-harvest", component: () => import("@/views/console/HarvestView.vue") },
      { path: "insights", name: "console-insights", component: () => import("@/views/console/InsightsView.vue") },
      { path: "analysis", name: "console-analysis", component: () => import("@/views/console/AnalysisView.vue") },
      // Not a view of a run but the way to make one: harvest a window and watch it land.
      { path: "run", name: "console-run", component: () => import("@/views/console/RunView.vue") },
    ],
  },
  // The scaffold's users demo, kept reachable so the original wiring check still works.
  { path: "/users", name: "users", component: () => import("@/views/UserView.vue") },
];

const router = createRouter({ history: createWebHistory(), routes });

export default router;
