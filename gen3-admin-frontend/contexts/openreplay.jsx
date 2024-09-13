import { createContext, useReducer, useEffect } from "react";
import { v4 as uuidV4 } from 'uuid';

export const TrackerContext = createContext();

const log = typeof window !== 'undefined' ? console.log : () => {};

function defaultGetUserId() {
    return uuidV4();
}

function newTracker(config, TrackerClass) { // Accept TrackerClass as an argument
    if (typeof window === 'undefined') {
        log("Tracker not created, not in browser");
        return null;
    }

    const getUserId = (config?.userIdEnabled && config?.getUserId) ? config.getUserId : defaultGetUserId;

    const trackerConfig = {
        // ingestPoint: "https://ae11-2600-1700-56e2-d050-65d7-62a4-a6ac-6a35.ngrok-free.app/endpoint/1",
        projectKey: "spgZeJSx3P96YdFR1T2u",
        ingestPoint: "https://openreplay.planx-pla.net/ingest",      
        __DISABLE_SECURE_MODE: true
    };

    log("Tracker configuration", trackerConfig);
    const tracker = new TrackerClass(trackerConfig); // Use the passed TrackerClass

    if (config?.userIdEnabled) {
        const userId = getUserId();
        tracker.setUserID(userId);
    }
    return tracker;
}

function reducer(state, action) {
    switch (action.type) {
        case 'init': {
            if (!state.tracker && action.Tracker) { 
                log("Instantiating the tracker for the first time...");
                return { ...state, tracker: newTracker(state.config, action.Tracker) }; 
            }
            return state;
        }
        case 'start': {
            log("Starting tracker...");
            log("Custom configuration received: ", state.config);
            state.tracker.start();
            return state;
        }
        default:
            return state; 
    }
}

export default function TrackerProvider({ children, config }) {
    const [state, dispatch] = useReducer(reducer, { tracker: null, config });
    useEffect(() => {
        import('@openreplay/tracker').then(({ default: Tracker }) => { 
            dispatch({ type: 'init', Tracker });
            dispatch({ type: 'start', Tracker });
        });
    }, []);

    const value = {
        startTracking: () => dispatch({ type: 'start', Tracker }),
        initTracker: () => dispatch({ type: 'init', Tracker }) // You might not need this anymore
    };

    return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>;
}