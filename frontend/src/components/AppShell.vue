<script setup lang="ts">
import { RouterLink } from 'vue-router'

const nav = [
  { to: '/', label: 'Report' },
  { to: '/regions', label: 'Bioregions' },
  { to: '/evaluation', label: 'Evaluation' },
]
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="border-b bg-background/95 backdrop-blur">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <RouterLink to="/" class="flex items-center gap-2 font-semibold">
          <span class="inline-block size-2.5 rounded-full bg-brand" aria-hidden="true" />
          Threatened Species Reporting
        </RouterLink>
        <nav class="flex gap-1 text-sm">
          <RouterLink
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            class="rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            active-class="!text-foreground bg-muted"
            :exact-active-class="item.to === '/' ? '!text-foreground bg-muted' : undefined"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
      </div>
    </header>

    <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <slot />
    </main>

    <footer class="border-t text-xs text-muted-foreground">
      <div class="mx-auto max-w-6xl space-y-1 px-4 py-4">
        <p>
          Occurrence data: Atlas of Living Australia, nationally threatened (EPBC) taxa, January 2015 – September 2026 —
          <a class="underline" href="https://doi.org/10.26197/ala.40eee344-07ce-48d2-9ec2-be39574ff4c7" target="_blank" rel="noopener">
            doi:10.26197/ala.40eee344-07ce-48d2-9ec2-be39574ff4c7
          </a>, and the contributing datasets it credits. Conservation status is as ALA attaches it.
        </p>
        <p>
          Occurrence records measure recording effort as well as animals and plants: every figure here is a signal to
          investigate, not a population estimate. Locations are reported at bioregion scale only.
        </p>
      </div>
    </footer>
  </div>
</template>
