<script setup lang="ts">
import { useAppStore } from '@/stores/useAppStore'

const store = useAppStore()
</script>

<template>
  <Transition name="slide-up">
    <div v-if="store.paramDirty" class="pending-bar" role="status" aria-live="polite">
      <span class="pending-bar__dot" aria-hidden="true" />
      <span class="pending-bar__text">
        有 <strong class="num">{{ store.pendingChangeCount }}</strong> 项参数修改未保存
        <span class="pending-bar__hint">{{ store.previewing ? '· 预览计算中…' : '· 当前为实时预览' }}</span>
      </span>
      <button class="btn btn--ghost btn--sm" type="button" :disabled="store.saving" @click="store.revertParameters()">
        撤销
      </button>
      <button class="btn btn--primary btn--sm" type="button" :disabled="store.saving" @click="store.submitParameters()">
        {{ store.saving ? '保存中…' : '提交并保存' }}
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.pending-bar {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  z-index: 55;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  max-width: calc(100vw - 32px);
  padding: 9px 12px 9px 16px;
  border-radius: 14px;
  border: 1px solid rgba(245, 158, 11, 0.4);
  background: var(--surface-solid);
  box-shadow: var(--shadow-lg);
  font-size: 12.5px;
  color: var(--text-2);
}

.pending-bar__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--warning);
  box-shadow: 0 0 0 4px var(--warning-soft);
  animation: pulse-ring 1.8s infinite;
}

.pending-bar__text strong {
  color: var(--warning);
}

.pending-bar__hint {
  color: var(--text-3);
  font-size: 11.5px;
  margin-left: 4px;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition:
    opacity 0.22s var(--ease-out),
    transform 0.22s var(--ease-out);
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}

@media (max-width: 720px) {
  .pending-bar {
    bottom: 12px;
  }
  .pending-bar__hint {
    display: none;
  }
}
</style>
