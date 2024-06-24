"use strict";
function parseQueryString() {
    let start = null;
    let end = null;
    if (location.search != '') {
        const params = location.search.substring(1).split('&');
        for (const param of params) {
            const [name, value] = param.split('=', 2);
            if (value === '') {
                continue;
            }
            if (name == 'start') {
                start = new Date(value);
            }
            else if (name == 'end') {
                end = new Date(value);
            }
        }
    }
    return [start, end];
}
function mapUnitToMax(unit) {
    switch (unit) {
        case 'ms':
            return 'sec';
        default:
            return unit;
    }
}
function unzip(entries, start, end) {
    const revisionsMap = new Map();
    const res = new Map();
    for (const entry of entries) {
        if ((start != null && entry.timestamp < start) ||
            (end != null && entry.timestamp > end)) {
            continue;
        }
        const entries = Object.entries(entry.metrics);
        for (let [key, [value, unit]] of entries) {
            if (!res.has(key)) {
                res.set(key, {
                    unit: mapUnitToMax(unit),
                    data: [],
                    revision: [],
                    timestamp: [],
                });
            }
            const r = res.get(key);
            if (unit == 'ms' && value < 1000) {
                r.unit = 'ms';
            }
            r.data.push(value);
            r.timestamp.push(entry.timestamp);
            const revisionHash = entry.revision.substring(0, entry.revision.length - 7);
            r.revision.push(revisionHash);
            revisionsMap.set(revisionHash, entry.timestamp);
        }
    }
    const sortedRevisionsHash = Array.from(revisionsMap)
        .sort(([, t1], [, t2]) => t1 - t2) // Sort by timestamp
        .map(([hash]) => hash); // Extract only the hash
    let newRes = new Map();
    for (let [key, metric] of res) {
        let plotName = key;
        const analysisStatsPrefix = 'analysis-stats/';
        // Check for aggregated series of form "analysis-stats/<seriesName>/<plotName>"
        //  - <seriesName> is the project (e.g. "ripgrep", "diesel")
        //  - <plotName> is the metric (e.g. "total memory", "total time"), it cannot contain a `/`
        if (key.startsWith(analysisStatsPrefix)) {
            const [_prefix, project, plot, maybePlot] = key.split('/');
            // we incorrectly emitted diesel/diesel at some point, so fix that here
            plotName = project === 'diesel' ? maybePlot : plot;
            metric.project = project;
        }
        if (!newRes.has(plotName)) {
            newRes.set(plotName, [[], metric.unit]);
        }
        const entry = newRes.get(plotName);
        entry[0].push(metric);
        if (entry[1] == 'sec' && metric.unit == 'ms') {
            entry[1] = 'ms';
        }
    }
    return [newRes, sortedRevisionsHash];
}
function show_notification(html_text) {
    var notificationElem = document.getElementById('notification');
    notificationElem.innerHTML = html_text;
    notificationElem.classList.remove('hidden');
    setTimeout(() => {
        notificationElem.classList.add('hidden');
    }, 3000);
}
async function main() {
    const DATA_URL = 'https://raw.githubusercontent.com/rust-analyzer/metrics/master/metrics.json';
    const data = await (await fetch(DATA_URL)).text();
    const entries = data
        .split('\n')
        .filter((it) => it.length > 0)
        .map((it) => JSON.parse(it));
    const [start, end] = parseQueryString();
    setTimeFrameInputs(start, end);
    const [metrics, _revisions] = unzip(entries, start ? +start / 1000 : null, end ? +end / 1000 : null);
    const bodyElement = document.getElementById('inner');
    const plots = new Map();
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
                name: project !== null && project !== void 0 ? project : plotName,
                line: {
                    shape: 'hv',
                },
                x: timestamp.map((n) => new Date(n * 1000)),
                y: data,
                hovertext: revision,
                hovertemplate: `%{y} ${unit}<br>(%{hovertext})`,
                visible: !(project === 'ripgrep' ||
                    project === 'diesel' ||
                    project === 'webrender'),
            });
        }
    }
    const sortedPlots = Array.from(plots.entries());
    sortedPlots.sort(([t], [t2]) => t.localeCompare(t2));
    for (const [, definition] of sortedPlots) {
        const plotDiv = document.createElement('div');
        definition.data.sort((a, b) => {
            if (a.name < b.name) {
                return -1;
            }
            else if (a.name > b.name) {
                return 1;
            }
            else {
                return 0;
            }
        });
        Plotly.newPlot(plotDiv, definition.data, definition.layout);
        plotDiv.on('plotly_click', (data) => {
            const commit_hash = data.points[0].hovertext;
            const url = `https://github.com/rust-analyzer/rust-analyzer/commit/${commit_hash}`;
            const notification_text = `Commit <b>${commit_hash}</b> URL copied to clipboard`;
            navigator.clipboard.writeText(url);
            show_notification(notification_text);
        });
        bodyElement.appendChild(plotDiv);
    }
}
function setDays(n) {
    const timestamp = +new Date() - n * 1000 * 60 * 60 * 24;
    const date = new Date(timestamp);
    setTimeFrameInputs(date, null);
}
function getTimeFrameInputs() {
    const start = document.getElementsByName('start')[0];
    const end = document.getElementsByName('end')[0];
    return [start, end];
}
function setTimeFrameInputs(start, end) {
    const [startInput, endInput] = getTimeFrameInputs();
    startInput.value = start ? start.toISOString().split('T')[0] : '';
    endInput.value = end ? end.toISOString().split('T')[0] : '';
}
main();
