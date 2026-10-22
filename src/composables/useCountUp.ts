import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** 数字变化时做一次平滑滚动，尊重 prefers-reduced-motion */
export function useCountUp(source: Ref<number | null | undefined>, duration = 520) {
  const display = ref<number | null>(source.value ?? null)
  let frame = 0

  const animate = (from: number, to: number) => {
    if (prefersReducedMotion() || duration <= 0) {
      display.value = to
      return
    }
    const startedAt = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      display.value = from + (to - from) * eased
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(tick)
  }

  watch(source, (next, previous) => {
    if (next === null || next === undefined) {
      display.value = null
      return
    }
    if (previous === null || previous === undefined) {
      display.value = next
      return
    }
    animate(previous, next)
  })

  onBeforeUnmount(() => cancelAnimationFrame(frame))

  return display
}
