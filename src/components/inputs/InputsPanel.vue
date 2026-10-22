<script setup lang="ts">
import SectionCard from '@/components/layout/SectionCard.vue'
import FeeBasisNote from './FeeBasisNote.vue'
import PlatformRateForm from './PlatformRateForm.vue'
import CommissionPanel from './CommissionPanel.vue'
import MissingCostTable from './MissingCostTable.vue'
import AdSpendTable from './AdSpendTable.vue'
import DatasetFiles from './DatasetFiles.vue'
import ParameterActions from './ParameterActions.vue'
</script>

<template>
  <SectionCard
    index="Ⅲ"
    title="人工填写与参数"
    sub="填写后实时预览毛利，确认无误后点击「提交并保存」写入配置；包装费/运费/运费险按平台独立设置，可选按件单价或直接填总额，达人佣金自动取自商务订单"
  >
    <template #actions>
      <ParameterActions />
    </template>

    <div class="inputs-stack">
      <FeeBasisNote />
      <PlatformRateForm />
    </div>

    <CommissionPanel />

    <MissingCostTable />

    <div class="inputs-divider"><span>数据源与统计口径</span></div>

    <div class="inputs-grid">
      <AdSpendTable />
      <DatasetFiles />
    </div>
  </SectionCard>
</template>

<style scoped>
.inputs-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-3);
}

.inputs-divider::before,
.inputs-divider::after {
  content: '';
  height: 1px;
  background: var(--line);
  flex: 1;
}
</style>
