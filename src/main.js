import { client, v1 } from "@datadog/datadog-api-client";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as yaml from "yaml";
import { StrongerPromise, remove_undefined, get_files } from "./utils.js";
import getopts from "getopts";
import clc from "cli-color"
import lodash from "lodash"
import path from "path"
import diffler from "diffler";

dotenv.config()
const args = process.argv

const dogops_signature = "dog-ops"
// Read template file for creating new monitor
const template_monitor = fs.existsSync("template.yaml") ? yaml.parse(fs.readFileSync("template.yaml", 'utf-8')) : {

}

const dogops_config = {
    exclude: [],
    pullLocation: v => `${v.id}.yaml`,
    validators: {
        default: () => true
    }
}

const configurationOpts = {
    authMethods: {
        apiKeyAuth: process.env["DD_API_KEY"],
        appKeyAuth: process.env["DD_APPLICATION_KEY"]
    },
};
const config = client.createConfiguration(configurationOpts)
const apiInstance = new v1.MonitorsApi(config)

async function pull_action(opts) {
    const list = await apiInstance.listMonitors({ monitorTags: dogops_signature })
    let promises = []
    for(let l of list) {
        const fn = dogops_config.pullLocation(l)
        promises.push(new Promise((resolve, reject) => {
            (async () => {
                await fs.promises.mkdir(path.dirname(fn), { recursive: true })
                if (fs.existsSync(fn)) {
                    // TODO: compare
                    const diff = compare_monitors(yaml.parse(await fs.promises.readFile(fn, 'utf-8')), l)
                    if(diff) {
                        console.log(`Update ${fn}`)
                        print_diff(diff)
                    }
                } else {
                    console.log(`Create ${fn}`)
                }
                await fs.promises.writeFile(fn, yaml.stringify(normalize_monitor(l)))
            })().then(_ => resolve()).catch((e) => reject(e))
        }))
    }
    await Promise.all(promises)
}

async function push_action(opts) {
    // TODO: remove orphans
    const flist = get_files(dogops_config.exclude)
    const promise_builders = []
    for (const fn of flist) {
        promise_builders.push(async () => {
            try {
                const f = yaml.parse(await fs.promises.readFile(fn, 'utf-8'))
                const m = await apiInstance.getMonitor({ monitorId: f.id })
                const diff = compare_monitors(m, f)
                if (diff) {
                    console.log(`Push ${fn}(https://app.datadoghq.com/monitors/${f.id}) ${f.name}`)
                    print_diff(diff)
                    await apiInstance.updateMonitor({ monitorId: f.id, body: lodash.pick(f, Object.keys(diff)) })
                }
            } catch(e) {
                debugger
            }
        })
    }

    await StrongerPromise.all(promise_builders, 20)
}

function normalize_monitor(monitor) {
    let obj = {}
    for(const prop of ["id", "type", "name", "message", "query", "tags", "options", "priority", "multi"]) {
        if(prop in monitor)
            obj[prop] = lodash.cloneDeep(monitor[prop])
    }

    if(obj.options) {
        // remove undefined
        // obj.options = remove_undefined(obj.options)
        obj.options = JSON.parse(JSON.stringify(obj.options))
    }
    
    return obj
}

function print_diff(diff, prefix='') {
    for(const [k, v] of Object.entries(diff)) {
        if(typeof v == 'object') {
            if('from' in v && 'to' in v) {
                process.stdout.write(`${prefix}${k}: ${clc.red(`${v.from}`)} -> ${clc.green(`${v.to}`)}\n`)
                // process.stdout.write(clc.red(`- ${prefix}${k}: ${v.from}\n`))
                // process.stdout.write(clc.green(`+ ${prefix}${k}: ${v.to}\n`))
            } else {
                process.stdout.write(`${prefix}${k}:\n`)
                print_diff(v, `${prefix}  `)
            }
        }
    }
}

function compare_monitors(lhs, rhs) {
    lhs = normalize_monitor(lhs)
    rhs = normalize_monitor(rhs)
    const diff = diffler(lhs, rhs)
    return Object.keys(diff).length > 0 ? diff : null
}

async function status_action(opts) {
    const list = await apiInstance.listMonitors({ monitorTags: dogops_signature })
    const flist = get_files(dogops_config.exclude)
    const fdict = {};
    
    let error = false;
    let synced = true;

    (await Promise.all(flist.map(
        async fn => yaml.parse((await fs.promises.readFile(fn, 'utf-8')))
    ))).forEach((v, idx) => {
        if(v.id in fdict) {
            throw `${flist[idx]} is duplicated with ${fdict[v.id].filename}`
        }
        fdict[v.id] = {
            filename: flist[idx],
            body: v,
        }
    });

    // Javascript type of key of object is string
    const orphans = lodash.difference(list.map(v => `${v.id}`), Object.keys(fdict))
    const newly_created = lodash.difference(Object.keys(fdict), list.map(v => `${v.id}`))

    orphans.forEach((monitor_id, idx) => {
        console.log(`Missing ${monitor_id}, will pull to ${dogops_config.pullLocation(list[idx])}`)
        synced = false
    })
    
    // TODO: How to handle newly created monitor?
    ////
    
    for(let l of list) {
        if(!(l.id in fdict))
            continue
        try {
            dogops_config.validators.default(fdict[l.id].body)
        } catch(e) {
            console.error(clc.red(`${fdict[l.id].filename} does not pass the validator, message: ${e}`))
            error = true
        }
        const diff = compare_monitors(l, fdict[l.id].body)
        if(diff) {
            console.log(`${fdict[l.id].filename}(https://app.datadoghq.com/monitors/${l.id}): ${l.name}`)
            print_diff(diff)
            synced = false
        }
    }
    if(!error && synced) {
        console.log("All monitors are synced")
    }
    if(error)
        process.exit(1)
}

async function query_action(opts) {
    const query = args[3]
    const result = await apiInstance.searchMonitors({ query: query })
    const results = await StrongerPromise.all(Array.from({length: result.metadata.pageCount}, (_, i) => i + 1).map(pg => () => apiInstance.searchMonitors({ query: query, page: pg })))
    results.forEach(r => {
        result.monitors.push(...r.monitors)
    })
    
    console.log(yaml.stringify(result))
}

async function delete_action(opts) {
    const monitor_id = args[3]
    if(!monitor_id) {
        console.error("Usage: main.js delete <id>")
        process.exit(1)
    }
    const detail = await apiInstance.getMonitor( { monitorId: monitor_id } )
    if(detail && detail.tags.indexOf(dogops_signature) != -1) {
        const result = await apiInstance.deleteMonitor( { monitorId: monitor_id })
        console.log(yaml.stringify(result))
    } else {
        console.error("This monitor is not managed by dogops")
        process.exit(1)
    }
}

async function create_action(opts) {
    const name = args[3]
    const filename = opts.filename
    if(!name && !filename) {
        console.error("Usage: main.js create <name> or main.js create -f <filename>")
        process.exit(1)
    }
    let based;
    if(filename) {
        // Read from stdin
        if(filename == '-')
            filename = 0
        based = yaml.parse(fs.readFileSync(filename, 'utf-8'))
    } else {
        based = JSON.parse(JSON.stringify(template_monitor))
        based.name = name
    }
    if(based.tags.indexOf(dogops_signature) == -1)
        based.tags.push(dogops_signature)
    const result = await apiInstance.createMonitor({ body: based })
    console.log(`Monitor ${result.id} created, https://app.datadoghq.com/monitors/${result.id}`)
    fs.writeFileSync(`${result.id}.yaml`, yaml.stringify(result))
}

async function main() {
    if(args.length < 3) {
        console.error("Usage: main.js <create|delete|pull|list|query|get>")
        process.exit(1)
    }
    try {
        const config = await import(path.join(process.cwd(), "dogops.config.js"))
        Object.assign(dogops_config, config.default)
    } catch(e) {}

    const opts = getopts(args.slice(2), { alias: { 'filename': ['f'] }})
    const actions = {
        "create": create_action,
        "delete": delete_action,
        "query": query_action,
        "pull": pull_action,
        "push": push_action,
        "status": status_action,
    }
    await actions[args[2]](opts)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
