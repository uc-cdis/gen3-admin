'use client'
import { createContext } from "react"
import Tracker from '@openreplay/tracker';
import { v4 as uuidV4 } from 'uuid'
import { useReducer } from "react"

export const TrackerContext = createContext()

function defaultGetUserId() {
    return uuidV4()
}

function newTracker(config) {
    if (typeof window !== 'undefined') { // checks that we are client-side

        const getUserId = (config?.userIdEnabled && config?.getUserId) ? config.getUserId : defaultGetUserId
        let userId = null;

        const trackerConfig = {
            projectKey: config?.projectKey || process.env.NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY
        }

        console.log("Tracker configuration")
        console.log(trackerConfig)
        const tracker = new Tracker(trackerConfig);

        if (config?.userIdEnabled) {
            userId = getUserId()
            tracker.setUserID(userId)
        }
        return tracker
    }
    return null
}

function reducer(state, action) {
    switch (action.type) {
        case 'init': {
            if (!state.tracker) {
                console.log("Instantiaing the tracker for the first time...")
                return { ...state, tracker: newTracker(state.config) }
            }
            return state
        }
        case 'start': {
            console.log("Starting tracker...")
            console.log("Custom configuration received: ", state.config)
            state.tracker.start()
            return state
        }
    }
}

export default function TrackerProvider({ children, config }) {
    let [state, dispatch] = useReducer(reducer, { tracker: null, config })


    let value = {
        startTracking: () => dispatch({ type: 'start' }),
        initTracker: () => dispatch({ type: 'init' })
    }


    return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>
}