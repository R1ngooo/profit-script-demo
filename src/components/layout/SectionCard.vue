<script setup lang="ts">
defineProps<{
  index?: string
  title: string
  sub?: string
}>()
</script>

<template>
  <section class="card section-card">
    <header class="section-head">
      <span v-if="index" class="section-index">{{ index }}</span>
      <div class="section-titles">
        <h2 class="section-title">
          {{ title }}
          <slot name="title-extra" />
        </h2>
        <p v-if="sub" class="section-sub">{{ sub }}</p>
      </div>
      <div v-if="$slots.actions" class="section-actions">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>
