import lodash from "lodash"
import wcmatch from "wildcard-match"
import glob from "glob"

export class StrongerPromise {
    /**
     * Promise.all with concurrency control
     * @param {Promise<any>} promise_builders - A callable that returns a promise
     * @param {number} concurrency - Limit of concurrency
     */
    static all(promise_builders, concurrency = 20) {
        return new Promise((resolve, reject) => {
            const result = new Array(promise_builders.length)
            let i = 0
            const worker = async (worker_id) => {
                while (i < promise_builders.length) {
                    // javascript is single-threaded
                    const idx = i++;
                    result[idx] = await promise_builders[idx]()
                }
            }
            Promise.all(new Array(Math.min(concurrency, promise_builders.length)).fill(0).map((_, idx) => {
                return worker(idx)
            }))
            .then(() => resolve(result)).catch(e => reject(e))
        })
    }
}

/**
 * Remove undefined in json recursively
 * @param {object} obj
 * @param {number} concurrency - Limit of concurrency
 */
export function remove_undefined(obj) {
    obj = lodash(obj).omitBy(lodash.isUndefined).value()
    Object.keys(obj).filter(k => typeof obj[k] == 'object' && obj[k] !== null).forEach(k => {
        obj[k] = remove_undefined(obj[k])
    })
    return obj
}

/**
 * Get all yaml file in current directly recursively
 * @param {Array<string>} exclude - Excluded paths, support wildcards
 */
export function get_files(exclude=[]) {
    return glob.sync("**/*.yaml").filter(v => v.match(/\d+\.yaml/)).filter(v => {
        return exclude.every(e => {
            return !wcmatch(e)(v)
        })
    })
}

