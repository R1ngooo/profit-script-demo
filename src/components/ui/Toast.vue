<script setup lang="ts">
import { useAppStore } from '@/stores/useAppStore'

const store = useAppStore()
</script>

<template>
  <Transition name="toast">
    <div v-if="store.toast" :key="store.toast.id" class="toast" :class="`toast--${store.toast.tone}`" role="status" aria-live="polite">
      <span class="toast__dot" />
      <span>{{ store.toast.message }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(460px, calc(100vw - 48px));
  padding: 13px 18px;
  border-radius: 14px;
  background: var(--surface-solid);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-lg);
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.toast__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.toast--success .toast__dot {
  background: var(--positive);
  box-shadow: 0 0 0 4px var(--positive-soft);
}
.toast--error .toast__dot {
  background: var(--negative);
  box-shadow: 0 0 0 4px var(--negative-soft);
}
.toast--info .toast__dot {
  background: var(--brand);
  box-shadow: 0 0 0 4px var(--brand-soft);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.25s var(--ease-out),
    transform 0.25s var(--ease-out);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
}
</style>
