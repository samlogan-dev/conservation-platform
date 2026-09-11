import apiClient from './apiClient'
import type { User } from '@/stores/userStore'

export const listUsersAPI = async (): Promise<User[]> => {
  const response = await apiClient.get('/users/')
  console.log('--> userAPI listUsers response:', response)
  return response.data
}

export const getUserAPI = async (userId: string): Promise<User> => {
  const response = await apiClient.get(`/users/${userId}`)
  console.log('--> userAPI getUser response:', response.data)
  return response.data
}

export const createUserAPI = async (payload: unknown): Promise<User> => {
  const response = await apiClient.post('/users/', payload)
  console.log('--> userAPI createUser response:', response.data)
  return response.data
}
