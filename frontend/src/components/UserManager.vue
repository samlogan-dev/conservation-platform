<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { ref, onMounted } from 'vue'
import { useUserStore } from '@/stores/userStore'

const userStore = useUserStore()
const { users, user } = storeToRefs(userStore)

onMounted(() => {
  userStore.listUsers()
})

const userIdInput = ref('')

function fetchUser() {
  if (userIdInput.value.trim()) {
    userStore.getUser(userIdInput.value.trim())
  }
}

const newUserEmail = ref('')

function handleCreateUser() {
  userStore.createUser({ email: newUserEmail.value })
  newUserEmail.value = ''
}
</script>

<template>
  <div class="p-4 space-y-6">
    <!-- Users List -->
    <section>
      <h3 class="font-semibold text-lg">Users List</h3>
      <ul class="list-disc pl-4">
        <li v-for="u in users" :key="u.id">ID: {{ u.id }} — {{ u.name }} — {{ u.email }}</li>
      </ul>
    </section>

    <!-- Fetch User by ID -->
    <section>
      <h3 class="font-semibold text-lg">Get User</h3>
      <div class="flex gap-2">
        <input
          v-model="userIdInput"
          type="text"
          placeholder="Enter user ID"
          class="border px-2 py-1 rounded"
        />
        <button @click="fetchUser" class="btn">Get User</button>
      </div>
      <p v-if="user" class="mt-2">Fetched User: {{ user }}</p>
    </section>

    <!-- Create User -->
    <section>
      <h3 class="font-semibold text-lg">Create User</h3>
      <div class="flex gap-2">
        <input
          v-model="newUserEmail"
          type="email"
          placeholder="Enter email"
          class="border px-2 py-1 rounded"
        />
        <button @click="handleCreateUser" class="btn">Create User</button>
      </div>
    </section>
  </div>
</template>
