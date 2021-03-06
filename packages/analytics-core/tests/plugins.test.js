import test from 'ava'
import sinon from 'sinon'
import delay from './utils/delay'
import Analytics from '../src'

test.beforeEach((t) => {
  t.context.sandbox = sinon.createSandbox()
})

test('Instance should contain no plugins', async (t) => {
  const analytics = Analytics({
    app: 'appname',
    version: 100
  })
  const { plugins } = analytics.getState()

  t.is(Object.keys(plugins).length, 0)
})

test('Instance should contain 1 plugin', async (t) => {
  const analytics = Analytics({
    app: 'appname',
    version: 100,
    plugins: [
      {
        NAMESPACE: 'plugin-one',
        page: () => {}
      }
    ]
  })

  const { plugins } = analytics.getState()

  t.is(Object.keys(plugins).length, 1)
})

test('Instance should contain 2 plugins', async (t) => {
  const analytics = Analytics({
    app: 'appname',
    version: 100,
    plugins: [
      {
        NAMESPACE: 'plugin-one',
        page: () => {}
      },
      {
        NAMESPACE: 'plugin-two',
        page: () => {},
        config: {
          lol: 'nice'
        }
      }
    ]
  })

  const { plugins } = analytics.getState()

  t.is(Object.keys(plugins).length, 2)
  t.is(plugins['plugin-one'].enabled, true)
  t.is(plugins['plugin-two'].enabled, true)
  t.deepEqual(plugins['plugin-two'].config, {
    lol: 'nice'
  })
})

test.cb('Instance should load plugins in correct order', (t) => {
  const pluginOrder = []
  const initializeOne = t.context.sandbox.spy()
  const initializeTwo = t.context.sandbox.spy()
  const analytics = Analytics({
    app: 'appname',
    version: 100,
    plugins: [
      {
        NAMESPACE: 'plugin-one',
        initialize: () => {
          pluginOrder.push(1)
          initializeOne()
        }
      },
      {
        NAMESPACE: 'plugin-two',
        initialize: () => {
          pluginOrder.push(2)
          initializeTwo()
        }
      }
    ]
  })

  analytics.ready(() => {
    t.is(initializeOne.callCount, 1)
    t.is(initializeTwo.callCount, 1)
    t.deepEqual(pluginOrder, [1, 2])
    t.end()
  })
})

test('Instance should not call any initialize if aborted', async (t) => {
  const initializeOne = t.context.sandbox.spy()
  const initializeTwo = t.context.sandbox.spy()
  const analytics = Analytics({
    app: 'appname',
    version: 100,
    plugins: [
      {
        NAMESPACE: 'cancel-plugin-loading',
        initializeStart: ({ payload }) => {
          return {
            abort: true
          }
        }
      },
      {
        NAMESPACE: 'plugin-one',
        initialize: initializeOne
      },
      {
        NAMESPACE: 'plugin-two',
        initialize: initializeTwo
      }
    ]
  })

  await delay(1000)

  t.is(initializeOne.callCount, 0)
  t.is(initializeTwo.callCount, 0)
})

test('Instance should not call specific initialize if plugin aborted by name', async (t) => {
  const initializeOne = t.context.sandbox.spy()
  const initializeTwo = t.context.sandbox.spy()
  const analytics = Analytics({
    app: 'appname',
    version: 100,
    plugins: [
      {
        NAMESPACE: 'cancel-plugin-loading',
        initializeStart: ({ payload }) => {
          return {
            abort: {
              plugins: ['plugin-one']
            }
          }
        }
      },
      {
        NAMESPACE: 'plugin-one',
        initialize: initializeOne
      },
      {
        NAMESPACE: 'plugin-two',
        initialize: initializeTwo
      }
    ]
  })

  await delay(1000)

  t.is(initializeOne.callCount, 0)
  t.is(initializeTwo.callCount, 1)
})
