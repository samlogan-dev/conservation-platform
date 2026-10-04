<script setup lang="ts">
defineProps<{ loading: boolean; error: string | null }>()
</script>

<template>
  <p v-if="loading" class="py-10 text-center text-sm text-muted-foreground">Loading…</p>
  <p v-else-if="error" class="rounded-md border border-alert/30 bg-alert-soft p-4 text-sm text-alert">
    Could not load: {{ error }}. Is the backend running (<code>npm run dev</code> in <code>backend/</code>) with Postgres up?
  </p>
  <slot v-else />
</template>
