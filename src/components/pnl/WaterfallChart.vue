<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { PlatformPnl } from '@shared/types'
import { buildWaterfall } from '@shared/types'
import { fmtCompact, fmtMoney, fmtPct } from '@/utils/format'
import { useAppStore } from '@/stores/useAppStore'

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{ pnl: PlatformPnl }>()
const store = useAppStore()

const container = ref<HTMLDivElement | null>(null)
let chart: ReturnType<typeof echarts.init> | null = null
let observer: ResizeObserver | null = null

const SHORT_LABELS: Record<string, string> = {
  settledSales: '结算额',
  productCost: '产品成本',
  packaging: '包装费',
  shipping: '运费',
  shippingInsurance: '运费险',
  techFee: '技术服务费',
  commercialInsurance: '商业保险',
  commission: '达人佣金',
  adSpend: '广告费',
  grossProfit: '毛利',
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function axisMoney(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e4) return `${(value / 1e4).toFixed(0)}万`
  return String(Math.round(value))
}

function buildOption() {
  const lines = buildWaterfall(props.pnl)
  const base: number[] = []
  const values: Array<{ value: number; itemStyle: { color: string; borderRadius: number[] } }> = []
  const labels = lines.map((line) => SHORT_LABELS[line.key] ?? line.label)

  const incomeColor = cssVar('--brand')
  const costColor = cssVar('--negative')
  const profitColor = cssVar('--positive')
  const lossColor = cssVar('--negative')
  const textColor = cssVar('--text-2')
  const text3 = cssVar('--text-3')
  const lineColor = cssVar('--line')
  const surface = cssVar('--surface-solid')
  const border = cssVar('--line')
  const text = cssVar('--text')

  let running = 0
  for (const line of lines) {
    if (line.kind === 'income') {
      base.push(0)
      values.push({ value: line.value, itemStyle: { color: incomeColor, borderRadius: [7, 7, 0, 0] } })
      running = line.value
    } else if (line.kind === 'cost') {
      base.push(Math.max(0, running - line.value))
      values.push({ value: Math.abs(line.value), itemStyle: { color: costColor, borderRadius: [7, 7, 0, 0] } })
      running -= line.value
    } else {
      base.push(Math.min(0, line.value))
      values.push({
        value: Math.abs(line.value),
        itemStyle: { color: line.value >= 0 ? profitColor : lossColor, borderRadius: [7, 7, 0, 0] },
      })
    }
  }

  return {
    animationDuration: 620,
    animationEasing: 'cubicOut' as const,
    grid: { left: 10, right: 14, top: 30, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(127,127,127,0.08)' } },
      backgroundColor: surface,
      borderColor: border,
      borderWidth: 1,
      padding: [10, 12],
      textStyle: { color: text, fontSize: 12 },
      formatter: (params: unknown) => {
        const list = params as Array<{ dataIndex: number }>
        const index = list?.[1]?.dataIndex ?? list?.[0]?.dataIndex ?? 0
        const line = lines[index]
        if (!line) return ''
        const share = props.pnl.settledSales ? line.value / props.pnl.settledSales : null
        const sign = line.kind === 'cost' ? '−' : line.kind === 'income' ? '+' : line.value < 0 ? '−' : '+'
        return `<div style="font-weight:700;margin-bottom:4px">${line.label}</div><div style="font-variant-numeric:tabular-nums">${sign}${fmtMoney(
          Math.abs(line.value),
        )}${share === null ? '' : `　<span style="opacity:.6">占结算额 ${fmtPct(Math.abs(share))}</span>`}</div>`
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: lineColor } },
      axisLabel: { color: text3, fontSize: 11, interval: 0 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: lineColor, type: 'dashed' } },
      axisLabel: { color: text3, fontSize: 10, formatter: (value: number) => axisMoney(value) },
      axisLine: { show: false },
    },
    series: [
      {
        name: 'placeholder',
        type: 'bar',
        stack: 'waterfall',
        silent: true,
        itemStyle: { color: 'transparent' },
        emphasis: { itemStyle: { color: 'transparent' } },
        data: base,
      },
      {
        name: '金额',
        type: 'bar',
        stack: 'waterfall',
        barMaxWidth: 34,
        data: values,
        label: {
          show: true,
          position: 'top',
          distance: 6,
          color: textColor,
          fontSize: 10,
          fontWeight: 600,
          formatter: (params: unknown) => {
            const item = params as { dataIndex: number; value: number }
            const line = lines[item.dataIndex]
            if (!line) return ''
            if (Math.abs(line.value) < 0.005) return ''
            const sign = line.kind === 'cost' ? '−' : line.kind === 'income' ? '+' : line.value < 0 ? '−' : '+'
            const compact = fmtCompact(Math.abs(line.value)).replace('¥', '')
            return `${sign}${compact}`
          },
        },
      },
    ],
  }
}

function render() {
  if (!chart) return
  chart.setOption(buildOption(), true)
}

onMounted(() => {
  if (!container.value) return
  chart = echarts.init(container.value)
  render()
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(container.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})

watch(
  () => props.pnl,
  () => render(),
  { deep: true },
)

watch(
  () => store.theme,
  async () => {
    await nextTick()
    render()
  },
)
</script>

<template>
  <div class="waterfall">
    <div ref="container" class="waterfall__canvas" role="img" aria-label="毛利瀑布图" />
    <div class="waterfall__legend">
      <span><i class="legend-dot legend-dot--income" />预估结算金额</span>
      <span><i class="legend-dot legend-dot--cost" />各项支出</span>
      <span><i class="legend-dot legend-dot--profit" />粗算毛利</span>
      <span class="waterfall__hint">按「预估结算金额 − 各项支出」逐项扣减</span>
    </div>
  </div>
</template>

<style scoped>
.waterfall {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.waterfall__canvas {
  width: 100%;
  height: 350px;
}

.waterfall__legend {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 11.5px;
  color: var(--text-3);
  padding: 0 4px;
}

.waterfall__legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 3px;
  display: inline-block;
}

.legend-dot--income {
  background: var(--brand);
}
.legend-dot--cost {
  background: var(--negative);
}
.legend-dot--profit {
  background: var(--positive);
}

.waterfall__hint {
  margin-left: auto;
  color: var(--text-3);
}
</style>
