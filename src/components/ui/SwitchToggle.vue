<script setup lang="ts">
defineProps<{
  modelValue: boolean
  label?: string
  hint?: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<template>
  <button
    type="button"
    class="switch"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="switch__track" :class="{ 'is-on': modelValue }"><span class="switch__thumb" /></span>
    <span v-if="label || hint" class="switch__text">
      <strong v-if="label">{{ label }}</strong>
      <small v-if="hint">{{ hint }}</small>
    </span>
  </button>
</template>

<style scoped>
.switch {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  padding: 6px 0;
  width: 100%;
}

.switch:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.switch__track {
  position: relative;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: var(--line-strong);
  flex: none;
  transition: background 0.18s ease;
}

.switch__track.is-on {
  background: linear-gradient(135deg, var(--brand), var(--brand-2));
}

.switch__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.18s var(--ease-out);
}

.switch__track.is-on .switch__thumb {
  transform: translateX(16px);
}

.switch__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.switch__text strong {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
}

.switch__text small {
  font-size: 11px;
  color: var(--text-3);
}
</style>
