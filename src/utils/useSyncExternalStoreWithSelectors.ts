/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import * as React from 'react';
import is from './objectIs';

// Intentionally not using named imports because Rollup uses dynamic dispatch
// for CommonJS interop.
const {useRef, useEffect, useMemo, useDebugValue} = React;

function isPromise(value) {
    return value !== null && typeof value === 'object' && typeof value.then === 'function';
}

// Same as useSyncExternalStore, but supports selector and isEqual arguments.
export function useSyncExternalStoreWithSelector(
    subscribe,
    getSnapshot,
    getServerSnapshot,
    selector,
    isEqual,
): Selection {
    // Use this to track the rendered snapshot.
    const instRef = useRef(null);
    let inst;
    if (instRef.current === null) {
        inst = {
            hasValue: false,
            value: null,
        };
        instRef.current = inst;
    } else {
        inst = instRef.current;
    }

    const [subscribeInternal, getSelection, getServerSelection] = useMemo(() => {
        // Track the memoized state using closure variables that are local to this
        // memoized instance of a getSnapshot function. Intentionally not using a
        // useRef hook, because that state would be shared across all concurrent
        // copies of the hook/component.
        let hasMemo = false;
        let memoizedSnapshot;
        let memoizedSelection: Selection;

        let firstRun = true
        let isSelectorPending = false // in case of async selector we need to wait for the value to be resolved

        const subscribers = new Set();



        function notifySubscribers() {
            subscribers.forEach((callback) => callback());
        }


        const memoizedSelector = (nextSnapshot: Snapshot) => {
            if (!hasMemo) {
                memoizedSnapshot = nextSnapshot;
                const nextSelection = selector(nextSnapshot);

                if (isPromise(nextSelection)) {
                    return nextSelection
                }

                // The first time the hook is called, there is no memoized result.
                hasMemo = true;

                if (isEqual !== undefined) {
                    // Even if the selector has changed, the currently rendered selection
                    // may be equal to the new selection. We should attempt to reuse the
                    // current value if possible, to preserve downstream memoizations.
                    if (inst.hasValue) {
                        const currentSelection = inst.value;
                        if (isEqual(currentSelection, nextSelection)) {
                            memoizedSelection = currentSelection;
                            return currentSelection;
                        }
                    }
                }
                memoizedSelection = nextSelection;
                return nextSelection;
            }

            // We may be able to reuse the previous invocation's result.
            const prevSnapshot = memoizedSnapshot
            const prevSelection = memoizedSelection

            if (is(prevSnapshot, nextSnapshot)) {
                // The snapshot is the same as last time. Reuse the previous selection.
                return prevSelection;
            }

            // The snapshot has changed, so we need to compute a new selection.
            const nextSelection = selector(nextSnapshot);

            if (isPromise(nextSelection)) {
                return nextSelection
            }

            // If a custom isEqual function is provided, use that to check if the data
            // has changed. If it hasn't, return the previous selection. That signals
            // to React that the selections are conceptually equal, and we can bail
            // out of rendering.
            if (isEqual !== undefined && isEqual(prevSelection, nextSelection)) {
                return prevSelection;
            }

            memoizedSnapshot = nextSnapshot;
            memoizedSelection = nextSelection;
            return nextSelection;
        };



        const waitForValueAndNotifySubscribers = async (nextSnapshot: Snapshot, nextSelectionPromise) => {
            if (!hasMemo) {
                memoizedSnapshot = nextSnapshot;

                isSelectorPending = true
                const nextSelection = await nextSelectionPromise;
                isSelectorPending = false

                // The first time the hook is called, there is no memoized result.
                hasMemo = true;

                if (isEqual !== undefined) {
                    // Even if the selector has changed, the currently rendered selection
                    // may be equal to the new selection. We should attempt to reuse the
                    // current value if possible, to preserve downstream memoizations.
                    if (inst.hasValue) {
                        const currentSelection = inst.value;
                        if (isEqual(currentSelection, nextSelection)) {
                            memoizedSelection = currentSelection;
                            return currentSelection;
                        }
                    }
                }

                memoizedSelection = nextSelection;
                notifySubscribers()
                return nextSelection;
            }

            // We may be able to reuse the previous invocation's result.
            const prevSnapshot = memoizedSnapshot
            const prevSelection = memoizedSelection

            if (is(prevSnapshot, nextSnapshot)) {
                // The snapshot is the same as last time. Reuse the previous selection.
                return prevSelection;
            }

            // The snapshot has changed, so we need to compute a new selection.
            isSelectorPending = true
            const nextSelection = await nextSelectionPromise;
            isSelectorPending = false

            // If a custom isEqual function is provided, use that to check if the data
            // has changed. If it hasn't, return the previous selection. That signals
            // to React that the selections are conceptually equal, and we can bail
            // out of rendering.
            if (isEqual !== undefined && isEqual(prevSelection, nextSelection)) {
                return prevSelection;
            }

            memoizedSnapshot = nextSnapshot;
            memoizedSelection = nextSelection;
            notifySubscribers()
            return nextSelection;
        };


        // trigger to run selector again
        const unsubscribeFromRedux = subscribe(() => {
            const nextSnapshot = getSnapshot();
            const nextSelection = memoizedSelector(nextSnapshot);

            if (isPromise(nextSelection)) {
                waitForValueAndNotifySubscribers(nextSnapshot, nextSelection)
                return
            } else {
                notifySubscribers()
            }
        })
        function subscribeInternal(callback) {
            subscribers.add(callback);
            return () => {
                subscribers.delete(callback);
                unsubscribeFromRedux()
            }
        }



        // Assigning this to a constant so that Flow knows it can't change.
        const maybeGetServerSnapshot =
            getServerSnapshot === undefined ? null : getServerSnapshot;

        const getSnapshotWithSelector = () => {
            const nextSnapshot = getSnapshot();

            // if the selector is async we want to resolve the value only once and wait for it
            if (isSelectorPending) {
                return memoizedSelection
            }

            const nextSelection = memoizedSelector(nextSnapshot);

            if (isPromise(nextSelection) && firstRun) {
                firstRun = false
                waitForValueAndNotifySubscribers(nextSnapshot, nextSelection)
            }

            return memoizedSelection
        }

        const getServerSnapshotWithSelector =
            maybeGetServerSnapshot === null
                ? undefined
                : () => memoizedSelector(maybeGetServerSnapshot());

        return [subscribeInternal, getSnapshotWithSelector, getServerSnapshotWithSelector];
    }, [getSnapshot, getServerSnapshot, selector, isEqual]);

    const value = React.useSyncExternalStore(
        subscribeInternal,
        getSelection,
        getServerSelection,
    );

    useEffect(() => {
        // $FlowFixMe[incompatible-type] changing the variant using mutation isn't supported
        inst.hasValue = true;
        // $FlowFixMe[incompatible-type]
        inst.value = value;
    }, [value]);

    useDebugValue(value);
    return value;
}
