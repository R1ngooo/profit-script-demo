<script setup lang="ts">
defineProps<{ message: string }>()
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="error-state card">
    <div class="error-state__icon" aria-hidden="true">!</div>
    <h2>数据加载失败</h2>
    <p>{{ message }}</p>
    <button class="btn btn--primary" type="button" @click="emit('retry')">重新加载</button>
    <p class="error-state__hint">请确认 excel/订单源、excel/成本表、excel/月消耗表 目录存在且文件未被 Excel 占用。</p>
  </div>
</template>

<style scoped>
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  padding: 48px 24px;
}

.error-state__icon {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  font-size: 24px;
  font-weight: 800;
  color: var(--negative);
  background: var(--negative-soft);
}

.error-state h2 {
  font-size: 18px;
  font-weight: 800;
}

.error-state p {
  font-size: 13px;
  color: var(--text-2);
  max-width: 560px;
}

.error-state__hint {
  font-size: 11.5px;
  color: var(--text-3);
}
</style>
