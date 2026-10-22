<script setup lang="ts">
import { ref, watch } from 'vue'
import { clamp } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    modelValue: number | null
    prefix?: string
    suffix?: string
    placeholder?: string
    min?: number
    max?: number
    disabled?: boolean
    align?: 'left' | 'right'
    width?: string
  }>(),
  { align: 'right', placeholder: '0' },
)

const emit = defineEmits<{ 'update:modelValue': [number | null]; commit: [] }>()

const focused = ref(false)
const draft = ref(format(props.modelValue))

function format(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return String(value)
}

watch(
  () => props.modelValue,
  (value) => {
    if (!focused.value) draft.value = format(value)
  },
)

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  draft.value = raw
  if (raw.trim() === '') {
    emit('update:modelValue', null)
    return
  }
  const parsed = Number(raw.replace(/[,，\s]/g, ''))
  if (!Number.isFinite(parsed)) return
  emit('update:modelValue', clamp(parsed, props.min, props.max))
}

function onBlur() {
  focused.value = false
  draft.value = format(props.modelValue)
  emit('commit')
}
</script>

<template>
  <label class="input-wrap" :class="{ 'is-disabled': disabled }" :style="width ? { width } : undefined">
    <span v-if="prefix" class="input-wrap__affix">{{ prefix }}</span>
    <input
      type="text"
      inputmode="decimal"
      :value="draft"
      :placeholder="placeholder"
      :disabled="disabled"
      :style="{ textAlign: align }"
      @input="onInput"
      @focus="focused = true"
      @blur="onBlur"
      @keydown.enter="($event.target as HTMLInputElement).blur()"
    />
    <span v-if="suffix" class="input-wrap__affix">{{ suffix }}</span>
  </label>
</template>

<style scoped>
.is-disabled {
  opacity: 0.55;
  pointer-events: none;
}
</style>
