import fitlerDisabledPlugins from '../../utils/filterDisabled'

export default async function (action, getPlugins, instance, store, eventsInfo) {
  const pluginObject = getPlugins()
  const eventType = action.type
  /* If action already dispatched exit early */
  if (action._ && action._.called) {
    // console.log('Already called', action._.called)
    // This makes it so plugin methods dont get fired twice.
    return action
  }

  // const actionDepth = (eventType.match(/:/g) || []).length
  // if (actionDepth > 2) {
  //   return action
  // }
  const state = instance.getState()

  /* Remove plugins that are disabled by options or by settings */
  const activePlugins = fitlerDisabledPlugins(pluginObject, state.plugins, action.options)
  // console.log('activePlugins', activePlugins)
  const allActivePluginKeys = activePlugins.map((p) => p.NAMESPACE)

  const allMatches = getAllMatchingCalls(eventType, activePlugins, pluginObject)
  /*
    @TODO cache matches and purge on enable/disable/add plugin
  */

  /**
   * Process all 'actionBefore' hooks
   * Example:
   *  This is process 'pageStart' methods from plugins and update the event to send through
   */
  const beforeAction = await processEvent({
    action: action,
    data: {
      exact: allMatches.before,
      namespaced: allMatches.beforeNS
    },
    state: state,
    allPlugins: pluginObject,
    allMatches,
    instance,
    store,
    EVENTS: eventsInfo
  })
  // console.log('____ beforeAction out', beforeAction)

  /* Abort if ‘eventBefore’ returns abort data */
  if (shouldAbortAll(beforeAction, allActivePluginKeys.length)) {
    return beforeAction
  }

  /* Filter over the plugin method calls and remove aborted plugin by name */
  const activeAndNonAbortedCalls = activePlugins.filter((plugin) => {
    if (shouldAbort(beforeAction, plugin.NAMESPACE)) return false
    return true
  })

  // console.log(`activeAndNonAbortedCalls ${action.type}`, activeAndNonAbortedCalls)
  const duringType = eventType.replace(/Start$/, '')
  // const duringMethods = getMatchingMethods(eventType.replace(/Start$/, ''), activePlugins)
  // console.log('duringMethods', duringMethods)
  /* Already processed and ran these methods */
  if (duringType === eventType) {
    // console.log('NAMES MATCH Dont process again', duringType, eventType)
  }

  /**
   * Process all 'action' hooks
   * Example:
   *  This is process 'page' methods from plugins and update the event to send through
   */
  const duringAction = (duringType === eventType) ? beforeAction : await processEvent({
    action: {
      ...beforeAction,
      type: formatMethod(eventType)
    },
    // data: duringMethods,
    data: {
      exact: allMatches.during,
      namespaced: allMatches.duringNS
    },
    state: state,
    allPlugins: pluginObject,
    allMatches,
    instance,
    store,
    EVENTS: eventsInfo
  })
  // console.log('____ duringAction', duringAction)

  /**
   * Process all 'actionEnd' hooks
   * Example:
   *  This is process 'pageEnd' methods from plugins and update the event to send through
   */
  const afterName = `${formatMethod(eventType)}End`
  const afterAction = await processEvent({
    action: {
      ...duringAction,
      type: afterName
    },
    data: {
      exact: allMatches.after,
      namespaced: allMatches.afterNS
    },
    state: state,
    allPlugins: pluginObject,
    allMatches,
    instance,
    store,
    EVENTS: eventsInfo
  })
  // console.log('____ afterAction', afterAction)

  /* Fire callback if supplied */
  const cb = getCallback(afterAction)
  if (cb) {
    /** @TODO figure out exact args calls and .on will get */
    cb({ payload: afterAction }) // eslint-disable-line
  }

  return beforeAction
}

function getCallback(action) {
  if (!action.meta) return false

  return Object.keys(action.meta).reduce((acc, key) => {
    const thing = action.meta[key]
    if (typeof thing === 'function') {
      return thing
    }
    return acc
  }, false)
}

/**
 * Async reduce over matched plugin methods
 * Fires plugin functions
 */
async function processEvent({
  data,
  action,
  instance,
  state,
  allPlugins,
  allMatches,
  store,
  EVENTS
}) {
  const { plugins } = state
  const method = action.type

  // console.log(`data ${method}`, data)
  // console.log(`data allMatches ${method}`, allMatches)
  let abortable = data.exact.map((x) => {
    return x.pluginName
  })

  /* If abort is called from xyzStart */
  if (method.match(/Start$/)) {
    abortable = allMatches.during.map((x) => {
      return x.pluginName
    })
  }

  /* make args for functions to concume */
  const makeArgs = argumentFactory(instance, abortable)
  // console.log('makeArgs', makeArgs)

  /* Check if plugin loaded, if not mark action for queue */
  const queueData = data.exact.reduce((acc, thing) => {
    const { pluginName, methodName } = thing
    let addToQueue = false
    if (!methodName.match(/^initialize/)) {
      addToQueue = !plugins[pluginName].loaded
    }
    acc[`${pluginName}`] = addToQueue
    return acc
  }, {})

  /* generate plugin specific payloads */
  const payloads = await data.exact.reduce(async (scoped, curr, i) => {
    const { pluginName } = curr
    const curScope = await scoped
    if (data.namespaced && data.namespaced[pluginName]) {
      const scopedPayload = await data.namespaced[pluginName].reduce(async (acc, p, count) => {
        // await value
        const curScopeData = await acc
        if (!p.method || typeof p.method !== 'function') {
          return curScopeData
        }

        /* Make sure plugins don’t call themselves */
        validateMethod(p.methodName, p.pluginName)

        function genAbort(currentAct, pname, otherPlug) {
          return function (reason, plugins) {
            const callsite = otherPlug || pname
            // console.log(`__abort msg: ${reason}`)
            // console.log(`__abort ${pname}`)
            // console.log(`__abort xxx: ${plugins}`)
            // console.log(`__abort otherPlug`, otherPlug)
            return {
              ...currentAct, // 🔥 todo verify this merge is ok
              abort: {
                reason: reason,
                plugins: plugins || [pname],
                caller: method,
                from: callsite
              }
            }
          }
        }

        // console.log(`funcArgs ${method}`, funcArgs)
        const val = await p.method({
          payload: curScopeData,
          instance,
          abort: genAbort(curScopeData, pluginName, p.pluginName),
          config: getConfig(pluginName, plugins, allPlugins),
          plugins: plugins
        })
        const returnValue = (typeof val === 'object') ? val : {}
        return Promise.resolve({
          ...curScopeData,
          ...returnValue
        })
      }, Promise.resolve(action))

      /* Set scoped payload */
      curScope[pluginName] = scopedPayload
    } else {
      /* Set payload as default action */
      curScope[pluginName] = action
    }
    return Promise.resolve(curScope)
  }, Promise.resolve({}))
  // console.log(`aaa scoped payloads ${action.type}`, payloads)

  // Then call the normal methods with scoped payload
  const resolvedAction = await data.exact.reduce(async (promise, curr, i) => {
    const lastLoop = data.exact.length === (i + 1)
    const { pluginName } = curr
    const currentPlugin = allPlugins[pluginName]
    const currentActionValue = await promise
    const payloadValue = (payloads[pluginName]) ? payloads[pluginName] : {}

    if (shouldAbort(payloadValue, pluginName)) {
      // console.log(`> Abort from payload specific "${pluginName}" abort value`, payloadValue)
      abortDispatch({
        data: payloadValue,
        method,
        instance,
        pluginName,
        store
      })
      return Promise.resolve(currentActionValue)
    }
    if (shouldAbort(currentActionValue, pluginName)) {
      // console.log(`> Abort from ${method} abort value`, currentActionValue)
      if (lastLoop) {
        abortDispatch({
          data: currentActionValue,
          method,
          instance,
          // pluginName,
          store
        })
      }
      return Promise.resolve(currentActionValue)
    }

    if (queueData.hasOwnProperty(pluginName) && queueData[pluginName] === true) {
      // console.log('Queue this instead', pluginName)
      store.dispatch({
        type: `queue`,
        plugin: pluginName,
        payload: payloadValue,
        /* Internal data for analytics engine */
        _: {
          called: `queue`,
          from: 'queueMechanism'
        }
      })
      return Promise.resolve(currentActionValue)
    }
    /*
    const checkForLoaded = () => {
      const p = instance.getState('plugins')
      return p[currentPlugin.NAMESPACE].loaded
    }
    // const p = instance.getState('plugins')
    console.log(`loaded "${currentPlugin.NAMESPACE}" > ${method}:`, p[currentPlugin.NAMESPACE].loaded)
    // await waitForReady(currentPlugin, checkForLoaded, 10000).then((d) => {
    //   console.log(`Loaded ${method}`, currentPlugin.NAMESPACE)
    // }).catch((e) => {
    //   console.log(`Error ${method} ${currentPlugin.NAMESPACE}`, e)
    //   // TODO dispatch failure
    // })
    */

    // @TODO figure out if we want queuing semantics

    const funcArgs = makeArgs(payloads[pluginName], allPlugins[pluginName])

    // console.log(`funcArgs ${method} ${pluginName}`, funcArgs)

    /* Run the plugin function */
    const val = await currentPlugin[method]({
      hello: pluginName,
      abort: funcArgs.abort,
      // Send in original action value or scope payload
      payload: payloads[pluginName], // || currentActionValue,
      instance,
      config: getConfig(pluginName, plugins, allPlugins),
      plugins: plugins
    })

    const returnValue = (typeof val === 'object') ? val : {}
    const merged = {
      ...currentActionValue,
      ...returnValue
    }

    const x = payloads[pluginName] // || currentActionValue
    if (shouldAbort(x, pluginName)) {
      // console.log(`>> HANDLE abort ${method} ${pluginName}`)
      abortDispatch({
        data: x,
        method,
        instance,
        pluginName,
        store
      })
    } else {
      const nameSpaceEvent = `${method}:${pluginName}`
      const actionDepth = (nameSpaceEvent.match(/:/g) || []).length
      if (actionDepth < 2 &&
        !method.match(/^bootstrap/) &&
        !method.match(/^ready/)
      ) {
        instance.dispatch({
          ...x,
          type: nameSpaceEvent,
          _: {
            called: nameSpaceEvent,
            from: 'submethod'
          }
        })
      }
    }
    // console.log('merged', merged)
    return Promise.resolve(merged)
  }, Promise.resolve(action))

  // Dispatch End
  if (!method.match(/Start$/) &&
      !method.match(/^registerPlugin/) &&
      !method.match(/^ready/) &&
      !method.match(/^bootstrap/) &&
      !method.match(/^params/)
  ) {
    if (EVENTS.plugins.includes(method)) {
      // console.log(`Dont dispatch for ${method}`, resolvedAction)
      // return resolvedAction
    }
    /*
    🔥🔥🔥
      Verify this original action setup.
      It's intended to keep actions from double dispatching themselves
    */
    if (resolvedAction._ && resolvedAction._.originalAction === method) {
      // console.log(`Dont dispatch for ${method}`, resolvedAction)
      return resolvedAction
    }
    store.dispatch({
      ...resolvedAction,
      ...{
        _: {
          originalAction: resolvedAction.type,
          called: resolvedAction.type,
          from: 'engineEnd'
        }
      }
    })
  }

  return resolvedAction
}

function abortDispatch({ data, method, instance, pluginName, store }) {
  const postFix = (pluginName) ? `:${pluginName}` : ''
  const abortEvent = `${method}Aborted${postFix}`
  store.dispatch({
    ...data,
    type: abortEvent,
    _: {
      called: abortEvent,
      from: 'abort'
    }
  })
}

function getConfig(pluginName, pluginState, allPlugins) {
  if (pluginState[pluginName] && pluginState[pluginName].config) {
    return pluginState[pluginName].config
  }
  if (allPlugins[pluginName] && allPlugins[pluginName].config) {
    return allPlugins[pluginName].config
  }
  return {}
}

function getPluginFunctions(methodName, plugins) {
  return plugins.reduce((arr, plugin) => {
    return (!plugin[methodName]) ? arr : arr.concat({
      methodName: methodName,
      pluginName: plugin.NAMESPACE,
      method: plugin[methodName],
    })
  }, [])
}

function formatMethod(type) {
  return type.replace(/Start$/, '')
}

/**
 * Return array of event names
 * @param  {String} eventType - original event type
 * @param  {String} namespace - optional namespace postfix
 * @return {[type]}           [description]
 */
function getEventNames(eventType, namespace) {
  const method = formatMethod(eventType)
  const postFix = (namespace) ? `:${namespace}` : ''
  // `typeStart:pluginName`
  const type = `${eventType}${postFix}`
  // `type:pluginName`
  const methodName = `${method}${postFix}`
  // `typeEnd:pluginName`
  const end = `${method}End${postFix}`
  return [ type, methodName, end ]
}

/* Collect all calls for a given event in the system */
function getAllMatchingCalls(eventType, activePlugins, allPlugins) {
  const eventNames = getEventNames(eventType)
  // console.log('eventNames', eventNames)
  // 'eventStart', 'event', & `eventEnd`
  const core = eventNames.map((word) => {
    return getPluginFunctions(word, activePlugins)
  })
  // Gather nameSpaced Events
  return activePlugins.reduce((acc, plugin) => {
    const { NAMESPACE } = plugin
    const nameSpacedEvents = getEventNames(eventType, NAMESPACE)
    // console.log('eventNames namespaced', nameSpacedEvents)
    const [ beforeFuncs, duringFuncs, afterFuncs ] = nameSpacedEvents.map((word) => {
      return getPluginFunctions(word, activePlugins)
    })

    if (beforeFuncs.length) {
      acc.beforeNS[NAMESPACE] = beforeFuncs
    }
    if (duringFuncs.length) {
      acc.duringNS[NAMESPACE] = duringFuncs
    }
    if (afterFuncs.length) {
      acc.afterNS[NAMESPACE] = afterFuncs
    }
    return acc
  }, {
    before: core[0],
    beforeNS: {},
    during: core[1],
    duringNS: {},
    after: core[2],
    afterNS: {}
  })
}

function shouldAbort({ abort }, pluginName) {
  if (!abort) return false
  if (abort === true) return true
  return includes(abort, pluginName) || (abort && includes(abort.plugins, pluginName))
}

function shouldAbortAll({ abort }, pluginsCount) {
  if (!abort) return false
  if (abort === true || typeof abort === 'string') return true
  const { plugins } = abort
  return isArray(abort) && (abort.length === pluginsCount) || isArray(plugins) && (plugins.length === pluginsCount)
}

function isArray(arr) {
  return Array.isArray(arr)
}

function includes(arr, name) {
  if (!arr || !isArray(arr)) return false
  return arr.includes(name)
}

/**
 * Generate arguments to pass to plugin methods
 * @param  {Object} instance - analytics instance
 * @param  {[type]} allPlugins [description]
 * @return {[type]}            [description]
 */
function argumentFactory(instance, abortablePlugins) {
  // console.log('abortablePlugins', abortablePlugins)
  return function (action, plugin, otherPlugin) {
    const { config, NAMESPACE } = plugin
    let method = `${NAMESPACE}.${action.type}`
    if (otherPlugin) {
      method = otherPlugin.event
    }

    const abortF = (action.type.match(/Start$/))
      ? abortFunction(NAMESPACE, method, abortablePlugins, otherPlugin, action)
      : notAbortableError(action, method)

    return {
      /* self: plugin, for future maybe */
      // clone objects to avoid reassign
      payload: formatPayload(action),
      instance: instance,
      config: config || {},
      abort: abortF
    }
  }
}

function abortFunction(pluginName, method, abortablePlugins, otherPlugin, action) {
  return function (reason, plugins) {
    const caller = (otherPlugin) ? otherPlugin.NAMESPACE : pluginName
    let pluginsToAbort = (plugins && isArray(plugins)) ? plugins : abortablePlugins
    if (otherPlugin) {
      pluginsToAbort = (plugins && isArray(plugins)) ? plugins : [pluginName]
      if (!pluginsToAbort.includes(pluginName) || pluginsToAbort.length !== 1) {
        throw new Error(`Method "${method}" can only abort "${pluginName}" plugin. ${JSON.stringify(pluginsToAbort)} input valid`)
      }
    }
    return {
      ...action, // 🔥 todo verify this merge is ok
      abort: {
        reason: reason,
        plugins: pluginsToAbort,
        caller: method,
        _: caller
      }
    }
  }
}

function notAbortableError(action, method) {
  return () => {
    throw new Error(`Action "${action.type}" is not cancellable. Remove abort call from plugin ${method}`)
  }
}

/**
 * Verify plugin is not calling itself with whatever:myPluginName self refs
 */
function validateMethod(actionName, pluginName) {
  const text = getNameSpacedAction(actionName)
  const methodCallMatchesPluginNamespace = text && (text.name === pluginName)
  if (methodCallMatchesPluginNamespace) {
    const sub = getNameSpacedAction(text.method)
    const subText = (sub) ? `or "${sub.method}"` : ''
    throw new Error([`Plugin "${pluginName}" is calling method [${actionName}]`,
      `Plugins should not call their own namespace.`,
      `Use "${text.method}" ${subText} in "${pluginName}" plugin instead of "${actionName}"`]
      .join('\n')
    )
  }
}

function getNameSpacedAction(event) {
  const split = event.match(/(.*):(.*)/)
  if (!split) {
    return false
  }
  return {
    method: split[1],
    name: split[2],
  }
}

function formatPayload(action) {
  return Object.keys(action).reduce((acc, key) => {
    // redact type from { payload }
    if (key === 'type') {
      return acc
    }
    if (typeof action[key] === 'object') {
      acc[key] = Object.assign({}, action[key])
    } else {
      acc[key] = action[key]
    }
    return acc
  }, {})
}

/*
function getMatchingMethods(eventType, activePlugins) {
  const exact = getPluginFunctions(eventType, activePlugins)
  // console.log('exact', exact)
  // Gather nameSpaced Events
  return activePlugins.reduce((acc, plugin) => {
    const { NAMESPACE } = plugin
    const clean = getPluginFunctions(`${eventType}:${NAMESPACE}`, activePlugins)
    if (clean.length) {
      acc.namespaced[NAMESPACE] = clean
    }
    return acc
  }, {
    exact: exact,
    namespaced: {}
  })
}
*/
