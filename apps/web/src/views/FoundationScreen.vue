<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
const route = useRoute()
const title = computed(() => String(route.meta.title ?? 'Раздел'))
</script>

<template>
  <section class="foundation-content">
    <h1>{{ title }}</h1>
    <p class="subtitle">Каркас интерфейса · P0</p>
    <div class="foundation-card">
      <p>Раздел подготовлен к подключению утверждённого Fieldwork UI.</p>
      <p class="muted">Пользовательские данные, камера, синхронизация и серверные действия ещё не подключены.</p>
    </div>
  </section>
</template>
