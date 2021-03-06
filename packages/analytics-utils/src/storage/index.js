import parse from './parse'
import globalContext from '../globalContext'
import hasLocalStorage from './hasLocalStorage'
import { getCookie, setCookie, removeCookie, cookiesSupported } from '../cookie'

/**
 * Get storage item from localStorage, cookie, or window
 * @param  {[type]} key - key of item to get
 * @param  {Object} opts - (optional)
 * @param  {String} opts.storage - Define type of storage to pull from.
 * @return {Any}  the value of key
 */
export function getItem(key, options = {}) {
  if (!key) return null
  const { storage } = options
  /* 1. Try localStorage */
  if (useLocal(storage)) {
    const value = localStorage.getItem(key)
    if (value || storage === 'localStorage') return parse(value)
  }
  /* 2. Fallback to cookie */
  if (useCookie(storage)) {
    const value = getCookie(key)
    if (value || storage === 'cookie') return parse(value)
  }
  /* 3. Fallback to window/global. TODO verify AWS lambda & check for conflicts */
  return globalContext[key] || null
}

/**
 * Store values in localStorage, cookie, or window
 * @param {String} key - key of item to set
 * @param {Any} value - value of item to set
 * @param {Object} opts - (optional)
 * @param {String} opts.storage - Define type of storage to set to.
 */
export function setItem(key, value, options = {}) {
  if (!key || !value) return false

  const { storage } = options
  const saveValue = JSON.stringify(value)

  /* 1. Try localStorage */
  if (useLocal(storage)) {
    // console.log('SET as localstorage', saveValue)
    const oldValue = parse(localStorage.getItem(key))
    localStorage.setItem(key, saveValue)
    return { value, oldValue, type: 'localStorage' }
  }
  /* 2. Fallback to cookie */
  if (useCookie(storage)) {
    // console.log('SET as cookie', saveValue)
    const oldValue = parse(getCookie(key))
    setCookie(key, saveValue)
    return { value, oldValue, type: 'cookie' }
  }
  /* 3. Fallback to window/global */
  const oldValue = globalContext[key]
  // console.log('SET as window', value)
  globalContext[key] = value
  return { value, oldValue, type: 'window' }
}

/**
 * Remove values from localStorage, cookie, or window
 * @param {String} key - key of item to set
 * @param {Object} opts - (optional)
 * @param {String} opts.storage - Define type of storage to set to.
 */
export function removeItem(key, options = {}) {
  if (!key) return false

  const { storage } = options
  /* 1. Try localStorage */
  if (useLocal(storage)) {
    localStorage.removeItem(key)
    return null
  }
  /* 2. Fallback to cookie */
  if (useCookie(storage)) {
    removeCookie(key)
    return null
  }
  /* 3. Fallback to window/global */
  globalContext[key] = null
  return null
}

function useLocal(storage) {
  return hasLocalStorage && (!storage || storage === 'localStorage')
}

function useCookie(storage) {
  return cookiesSupported && (!storage || storage === 'cookie')
}

export default {
  getItem,
  setItem,
  removeItem
}
