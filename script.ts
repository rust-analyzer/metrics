type Unit = 'MB' | 'ms' | 'sec';
type MemoryMetric = [number, 'MB'];
type TimeMetric = [number, 'ms'];

type Entry = {
    host: {
        os: string;
        cpu: string;
        mem: string;
    };
    timestamp: number;
    revision: string;
    metrics: {
        build?: TimeMetric;
        [key: `analysis-stats/${string}/${string}`]: TimeMetric | MemoryMetric;
    };
};

type Metric = {
    project?: string;
    data: number[];
    revision: string[];
    timestamp: number[];
};

type Plots = {
    data: (Plotly.Data & { name: string })[];
    layout: Partial<Plotly.Layout>;
};

function parseQueryString(): [Date | null, Date | null] {
    let start: Date | null = null;
    let end: Date | null = null;
    if (location.search != '') {
        const params = location.search.substring(1).split('&');
        for (const param of params) {
            const [name, value] = param.split('=', 2);
            if (value === '') {
                continue;
            }
            if (name == 'start') {
                start = new Date(value);
            } else if (name == 'end') {
                end = new Date(value);
            }
        }
    }
    return [start, end];
}

function mapUnitToMax(unit: Unit): Unit {
    switch (unit) {
        case 'ms':
            return 'sec';
        default:
            return unit;
    }
}

function unzip(
    entries: Entry[],
    start: number | null,
    end: number | null
): [Map<string, [Metric[], Unit]>, string[]] {
    const revisionsMap = new Map<string, number>();
    const res = new Map<keyof Entry['metrics'], Metric & { unit: Unit }>();

    for (const entry of entries) {
        if (
            (start != null && entry.timestamp < start) ||
            (end != null && entry.timestamp > end)
        ) {
            continue;
        }

        const entries = Object.entries(entry.metrics) as [
            keyof Entry['metrics'],
            TimeMetric | MemoryMetric
        ][];
        for (let [key, [value, unit]] of entries) {
            if (!res.has(key)) {
                res.set(key, {
                    unit: mapUnitToMax(unit),
                    data: [],
                    revision: [],
                    timestamp: [],
                });
            }
            const r = res.get(key)!;

            if (unit == 'ms' && value < 1000) {
                r.unit = 'ms';
            }

            r.data.push(value);
            r.timestamp.push(entry.timestamp);
            const revisionHash = entry.revision.substring(
                0,
                entry.revision.length - 7
            );
            r.revision.push(revisionHash);
            revisionsMap.set(revisionHash, entry.timestamp);
        }
    }

    const sortedRevisionsHash = Array.from(revisionsMap)
        .sort(([, t1], [, t2]) => t1 - t2) // Sort by timestamp
        .map(([hash]) => hash); // Extract only the hash

    let newRes = new Map<string, [Metric[], Unit]>();

    for (let [key, metric] of res) {
        let plotName: string = key;
        const analysisStatsPrefix = 'analysis-stats/';
        // Check for aggregated series of form "analysis-stats/<seriesName>/<plotName>"
        //  - <seriesName> is the project (e.g. "ripgrep", "diesel")
        //  - <plotName> is the metric (e.g. "total memory", "total time"), it cannot contain a `/`
        if (plotName.startsWith(analysisStatsPrefix)) {
            const plotNameStart = plotName.lastIndexOf('/');
            const seriesNameStart = plotName.lastIndexOf(
                '/',
                plotNameStart - 1
            );
            plotName = plotName.substring(plotNameStart + 1);
            metric.project = plotName.substring(
                seriesNameStart + 1,
                plotNameStart
            );
        }

        if (!newRes.has(plotName)) {
            newRes.set(plotName, [[], metric.unit]);
        }
        const entry = newRes.get(plotName)!;
        entry[0].push(metric);
        if (entry[1] == 'sec' && metric.unit == 'ms') {
            entry[1] = 'ms';
        }
    }

    return [newRes, sortedRevisionsHash];
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
    const DATA_URL =
        'https://raw.githubusercontent.com/rust-analyzer/metrics/master/metrics.json';
    const data = await (await fetch(DATA_URL)).text();
    const entries: Entry[] = data
        .split('\n')
        .filter((it) => it.length > 0)
        .map((it) => JSON.parse(it));

    const [start, end] = parseQueryString();
    setTimeFrameInputs(start, end);
    const [metrics, _revisions] = unzip(
        entries,
        start ? +start / 1000 : null,
        end ? +end / 1000 : null
    );

    const bodyElement = document.getElementById('inner')!;
    const plots = new Map<string, Plots>();

    for (let [plotName, [metric, unit]] of metrics) {
        let plot = plots.get(plotName);
        if (!plot) {
            plot = {
                data: [],
                layout: {
                    title: plotName,
                    xaxis: {
                        type: 'date',
                    },
                    yaxis: {
                        title: unit,
                        rangemode: 'tozero',
                    },
                    width: Math.min(1200, window.innerWidth - 30),
                    margin: {
                        l: 50,
                        r: 20,
                        b: 100,
                        t: 100,
                        pad: 4,
                    },
                    legend: {
                        orientation: window.innerWidth < 700 ? 'h' : 'v',
                    },
                },
            };
            plots.set(plotName, plot);
        }
        for (let { data, revision, timestamp, project } of metric) {
            if (unit == 'sec') {
                data = data.map((it) => it / 1000);
            }

            plot.data.push({
                name: project ?? plotName,
                line: {
                    shape: 'hv',
                },
                x: timestamp.map((n) => new Date(n * 1000)),
                y: data,
                hovertext: revision,
                hovertemplate: `%{y} ${unit}<br>(%{hovertext})`,
            });
        }
    }
    const sortedPlots = Array.from(plots.entries());
    sortedPlots.sort(([t], [t2]) => t.localeCompare(t2));
    for (const [, definition] of sortedPlots) {
        const plotDiv = document.createElement(
            'div'
        ) as any as Plotly.PlotlyHTMLElement;

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
        plotDiv.on('plotly_click', (data) => {
            const commit_hash: string = (data.points[0] as any).hovertext;
            const url = `https://github.com/rust-analyzer/rust-analyzer/commit/${commit_hash}`;
            const notification_text = `Commit <b>${commit_hash}</b> URL copied to clipboard`;
            navigator.clipboard.writeText(url);
            show_notification(notification_text);
        });
        bodyElement.appendChild(plotDiv);
    }
}

function setDays(n: number) {
    const timestamp = +new Date() - n * 1000 * 60 * 60 * 24;
    const date = new Date(timestamp);
    setTimeFrameInputs(date, null);
}

function getTimeFrameInputs(): [HTMLInputElement, HTMLInputElement] {
    const start = document.getElementsByName('start')[0] as HTMLInputElement;
    const end = document.getElementsByName('end')[0] as HTMLInputElement;
    return [start, end];
}

function setTimeFrameInputs(start: Date | null, end: Date | null) {
    const [startInput, endInput] = getTimeFrameInputs();
    (startInput as any).value = start ? start.toISOString().split('T')[0] : '';
    (endInput as any).value = end ? end.toISOString().split('T')[0] : '';
}

main();
