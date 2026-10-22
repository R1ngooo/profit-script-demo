<script setup lang="ts">
import { RULE_LEGEND } from '@shared/rules'
</script>

<template>
  <div class="rule-legend">
    <div class="rule-legend__head">自动判定规则（人工拖拽结果优先于规则）</div>
    <ul class="rule-legend__list">
      <li v-for="rule in RULE_LEGEND" :key="rule.id" class="rule-legend__item">
        <span class="dot" :class="`dot--${rule.tone}`" />
        <div class="rule-legend__text">
          <strong>{{ rule.label }}</strong>
          <span>{{ rule.description }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.rule-legend {
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--surface-muted);
  padding: 13px 15px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rule-legend__head {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
}

.rule-legend__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 8px 18px;
}

.rule-legend__item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 11.5px;
  color: var(--text-3);
}

.rule-legend__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.rule-legend__text strong {
  font-size: 12px;
  color: var(--text-2);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 5px;
  flex: none;
}

.dot--settle {
  background: var(--positive);
}
.dot--refund {
  background: var(--negative);
}
.dot--neutral {
  background: var(--warning);
}
</style>
