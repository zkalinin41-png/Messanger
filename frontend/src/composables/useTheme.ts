import { ref, type Ref } from 'vue'

const isDark: Ref<boolean> = ref(localStorage.getItem('theme') === 'dark')

function applyTheme(): void {
    document.documentElement.classList.toggle('dark', isDark.value)
}

applyTheme()

export function useTheme() {
    function toggleTheme(): void {
        isDark.value = !isDark.value
        localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
        applyTheme()
    }
    return { isDark, toggleTheme }
}
