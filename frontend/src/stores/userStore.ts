import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getUserAPI, listUsersAPI, createUserAPI } from '@/apis/userAPI'

export interface User {
  id: string
  name: string
  email: string
}

export const useUserStore = defineStore('userStore', () => {
  const users = ref<User[]>([])
  const user = ref<User | null>(null)

  async function listUsers() {
    const res = await listUsersAPI()
    users.value = res
  }

  async function getUser(userId: string) {
    const res = await getUserAPI(userId)
    user.value = res
  }

  async function createUser(payload: unknown) {
    const newUser = await createUserAPI(payload)
    users.value.push(newUser)
  }

  return { users, user, listUsers, getUser, createUser }
})
