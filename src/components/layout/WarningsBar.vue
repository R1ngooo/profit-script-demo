<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ warnings: string[] }>()
const open = ref(true)
</script>

<template>
  <div class="warnbar">
    <button class="warnbar__head" type="button" :aria-expanded="open" @click="open = !open">
      <span class="warnbar__icon" aria-hidden="true">!</span>
      <strong>计算提示</strong>
      <span class="badge badge--warning">{{ warnings.length }}</span>
      <span class="warnbar__toggle">{{ open ? '收起' : '展开' }}</span>
    </button>
    <Transition name="warn">
      <ul v-if="open" class="warnbar__list">
        <li v-for="(warning, index) in warnings" :key="index">{{ warning }}</li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.warnbar {
  border-radius: var(--radius-lg);
  border: 1px solid rgba(245, 158, 11, 0.32);
  background: var(--warning-soft);
  overflow: hidden;
}

.warnbar__head {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 11px 16px;
  font-size: 12.5px;
  color: var(--warning);
  text-align: left;
}

.warnbar__icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.55);
  font-weight: 800;
  font-size: 12px;
  flex: none;
}

.warnbar__head strong {
  font-weight: 700;
}

.warnbar__toggle {
  margin-left: auto;
  font-size: 11.5px;
  opacity: 0.85;
}

.warnbar__list {
  margin: 0;
  padding: 0 16px 12px 45px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--warning);
  line-height: 1.55;
}

.warn-enter-active,
.warn-leave-active {
  transition: opacity 0.18s ease;
}
.warn-enter-from,
.warn-leave-to {
  opacity: 0;
}
</style>
