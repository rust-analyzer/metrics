type Unit = "MB" | "ms" | "sec" | "#instr" | "# thousand instr" | "# million instr"
type MemoryMetric = [number, "MB"]
type TimeMetric = [number, "ms"]

interface Entry {
    host: {
        os: string
        cpu: string
        mem: string
    },
    timestamp: number
    revision: string
    metrics: {
        "analysis-stats/ripgrep/total memory"?: MemoryMetric
        "analysis-stats/ripgrep/total time"?: TimeMetric
        "analysis-stats/self/total memory"?: MemoryMetric
        "analysis-stats/self/total time"?: TimeMetric
        "analysis-stats/webrender/total memory"?: MemoryMetric
        "analysis-stats/webrender/total time"?: TimeMetric
        "build"?: TimeMetric
    }
}

interface Metric {
    unit: Unit
    data: number[]
    revision: string[]
}

interface Plots {
    data: (Plotly.Data & { name: string })[]
    layout: Partial<Plotly.Layout>
}

function parseQueryString(): [Date | null, Date | null] {
    let start: Date | null = null;
    let end: Date | null = null;
    if (location.search != "") {
        const params = location.search.substr(1).split("&");
        for (const param of params) {
            const [name, value] = param.split("=", 2);
            if (value === "") {
                continue;
            }
            if (name == "start") {
                start = new Date(value);
            } else if (name == "end") {
                end = new Date(value);
            }
        }
    }
    return [start, end]
}

function unzip(entries: Entry[], start: number | null, end: number | null): [Map<string, Metric>, string[]] {
    const revisionsMap = new Map<string, number>();
    const res = new Map<string, Metric>();

    for (const entry of entries) {
        if ((start != null && entry.timestamp < start) || (end != null && entry.timestamp > end)) {
            continue;
        }

        for (let [key, [value, unit]] of Object.entries(entry.metrics)) {
            if (!res.has(key)) {
                res.set(key, {
                    unit: unit,
                    data: [],
                    revision: [],
                });
            }
            const r = res.get(key)!;
            r.data.push(value);
            const revisionHash = entry.revision.substr(0, 7);
            r.revision.push(revisionHash);
            revisionsMap.set(revisionHash, entry.timestamp);
        }
    }

    const sortedRevisionsHash = Array.from(revisionsMap)
        .sort(([, t1], [, t2]) => t1 - t2) // Sort by timestamp
        .map(([hash]) => hash); // Extract only the hash

    return [res, sortedRevisionsHash];
}

function show_notification(html_text: string) {
    var notificationElem = document.getElementById('notification')!;
    notificationElem.innerHTML = html_text;
    notificationElem.classList.remove('hidden');
    setTimeout(() => {
        notificationElem.classList.add('hidden');
    }, 3000);
}

async function main() {
    const DATA_URL = "https://raw.githubusercontent.com/rust-analyzer/metrics/master/metrics.json";
    const data = await (await fetch(DATA_URL)).text();
    const entries: Entry[] = data.split('\n')
        .filter((it) => it.length > 0)
        .map((it) => JSON.parse(it));

    const [start, end] = parseQueryString();
    const [metrics, revisions] = unzip(entries, start ? +start / 1000 : null, end ? +end / 1000 : null);

    const bodyElement = document.getElementById("inner")!;
    const plots = new Map<string, Plots>();
    for (let [series, { unit, data, revision }] of metrics) {
        if (unit == "ms" && data.every(it => it >= 1000)) {
            unit = "sec";
            data = data.map(it => it / 1000);
        } else if (unit == "#instr") {
            if (data.every(it => it > 1000)) {
                unit = "# thousand instr";
                data = data.map(it => it / 1000);
                if (data.every(it => it > 1000)) {
                    unit = "# million instr";
                    data = data.map(it => it / 1000);
                }
            }
        }

        let plotName = series;
        let seriesName: string;
        const analysisStatsPrefix = 'analysis-stats/';
        // Check for aggregated series of form "analysis-stats/<seriesName>/<plotName>"
        //  - <seriesName> is the project (e.g. "ripgrep", "diesel")
        //  - <plotName> is the metric (e.g. "total memory", "total time"), it cannot contain a `/`
        if (plotName.startsWith(analysisStatsPrefix)) {
            const plotNameStart = plotName.lastIndexOf("/");
            const seriesNameStart = plotName.lastIndexOf("/", plotNameStart - 1);
            seriesName = plotName.substring(seriesNameStart + 1, plotNameStart);
            plotName = plotName.substring(plotNameStart + 1);
        } else {
            seriesName = series;
        }
        let plot = plots.get(plotName);
        if (!plot) {
            plot = {
                data: [],
                layout: {
                    title: plotName,
                    yaxis: {
                        title: unit,
                        rangemode: 'tozero'
                    },
                    width: Math.min(1024, window.innerWidth),
                }
            };
            plots.set(plotName, plot);
        }
        plot.data.push({
            name: seriesName,
            line: {
                shape: "hv",
            },
            x: revision,
            y: data,
        });
    }

    for (const [title, definition] of plots) {
        const plotDiv = document.createElement("div") as any as Plotly.PlotlyHTMLElement;

        // As every metrics does not have the same historic revisions we specify the order
        definition.layout.xaxis = {
            type: 'category',
            categoryorder: 'array',
            categoryarray: revisions
        }

        definition.data.sort((a, b) => {
            if (a.name < b.name) {
                return -1;
            } else if (a.name > b.name) {
                return 1;
            } else {
                return 0;
            }
        });

        Plotly.newPlot(plotDiv, definition.data, definition.layout);
        plotDiv.on("plotly_click", (data) => {
            const commit_hash = data.points[0].x;
            const url = `https://github.com/rust-analyzer/rust-analyzer/commit/${commit_hash}`;
            const notification_text = `Commit <b>${commit_hash}</b> URL copied to clipboard`;
            navigator.clipboard.writeText(url);
            show_notification(notification_text);
        });
        bodyElement.appendChild(plotDiv);
    }
}
main();

function setDays(n: number) {
    const timestamp = +new Date() - (n * 1000 * 60 * 60 * 24);
    const date = new Date(timestamp);

    const start = document.getElementsByName('start')[0] as HTMLInputElement;
    const end = document.getElementsByName('end')[0] as HTMLInputElement;
    start.value = date.toISOString().split('T')[0];
    end.value = "";
}
