<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

type StatsItem = {
  id: string;
  name: string;
  author: string;
  repoUrl: string | null;
  isRust: boolean;
  languages: Record<string, number>;
};

type StatsResponse = {
  totals: {
    target: number;
    rust: number;
    rustRatioOfTarget: number;
  };
  items: StatsItem[];
};

type RepositoryItem = {
  id: string;
  name: string;
  author: string;
  repoUrl: string;
};

const stats = ref<StatsResponse | null>(null);
const errorMessage = ref<string | null>(null);
const isLoading = ref(true);

const rustRepositories = computed(() => {
  if (stats.value === null) {
    return [];
  }

  return stats.value.items
    .filter((item) => item.isRust)
    .sort((left, right) => rustBytes(right) - rustBytes(left))
    .map((item): RepositoryItem => {
      if (item.repoUrl === null) {
        throw new Error(`${item.name} has no repository URL.`);
      }

      return {
        id: item.id,
        name: item.name,
        author: item.author,
        repoUrl: item.repoUrl,
      };
    });
});

const rustRatio = computed(() => {
  if (stats.value === null) {
    return 0;
  }

  return stats.value.totals.rustRatioOfTarget;
});

const rustPercent = computed(() => formatPercent(rustRatio.value));
const progressValue = computed(() => `${Math.max(0, Math.min(1, rustRatio.value)) * 100}%`);

onMounted(async () => {
  try {
    const response = await fetch("/api/stats");
    const payload = await response.json();
    if (!response.ok) {
      const error = payload as { error?: unknown };
      if (typeof error.error !== "string") {
        throw new Error("API request failed.");
      }
      throw new Error(error.error);
    }
    stats.value = payload as StatsResponse;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unknown error.";
  } finally {
    isLoading.value = false;
  }
});

function formatPercent(value: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function rustBytes(item: StatsItem): number {
  const bytes = item.languages.Rust;
  if (bytes === undefined) {
    return 0;
  }
  return bytes;
}
</script>

<template>
  <main class="page">
    <h1>Are We Rust Yet on AviUtl2?</h1>

    <p>
      AviUtl2カタログに登録されているスクリプト・プラグインのうち、Rustで書かれたものがどれくらいあるのかを示すサイトです。
    </p>
    <p v-if="isLoading" class="status" aria-live="polite">Loading...</p>
    <p v-else-if="errorMessage !== null" class="status status--error" aria-live="assertive">
      {{ errorMessage }}
    </p>

    <template v-else-if="stats !== null">
      <section class="answer" aria-label="Rust percentage">
        <p class="answer__value">{{ rustPercent }}</p>
        <div
          class="progress"
          role="meter"
          aria-label="Rust percentage"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(rustRatio * 100)"
        >
          <span class="progress__bar" :style="{ inlineSize: progressValue }" />
        </div>
      </section>

      <ol class="repo-list" aria-label="Rust repositories">
        <li v-for="repository in rustRepositories" :key="repository.id">
          <a :href="repository.repoUrl" target="_blank" rel="noreferrer">
            {{ repository.name }}
          </a>
          / {{ repository.author }}
        </li>
      </ol>
    </template>
  </main>
</template>
