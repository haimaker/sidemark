import {render} from 'preact'
import {App} from './app'
import {applyTheme, storedTheme} from './model/theme'
import './styles.css'

// Before the first render, so a remembered theme never flashes the other one.
applyTheme(storedTheme())

render(<App />, document.getElementById('app')!)
