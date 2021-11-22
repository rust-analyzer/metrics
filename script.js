"use strict";
function parseQueryString() {
    let start = null;
    let end = null;
    if (location.search != "") {
        const params = location.search.substr(1).split("&");
        for (const param of params) {
            const [name, value] = param.split("=", 2);
            if (value === "") {
                continue;
            }
            if (name == "start") {
                start = new Date(value);
            }
            else if (name == "end") {
                end = new Date(value);
            }
        }
    }
    return [start, end];
}
function unzip(entries, start, end) {
    const revisionsMap = new Map();
    const res = new Map();
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
                    timestamp: [],
                });
            }
            const r = res.get(key);
            r.data.push(value);
            r.timestamp.push(entry.timestamp);
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
function show_notification(html_text) {
    var notificationElem = document.getElementById('notification');
    notificationElem.innerHTML = html_text;
    notificationElem.classList.remove('hidden');
    setTimeout(() => {
        notificationElem.classList.add('hidden');
    }, 3000);
}
async function main() {
    const DATA_URL = "https://raw.githubusercontent.com/rust-analyzer/metrics/master/metrics.json";
    const data = await (await fetch(DATA_URL)).text();
    const entries = data.split('\n')
        .filter((it) => it.length > 0)
        .map((it) => JSON.parse(it));
    const [start, end] = parseQueryString();
    setTimeFrameInputs(start, end);
    const [metrics, revisions] = unzip(entries, start ? +start / 1000 : null, end ? +end / 1000 : null);
    const bodyElement = document.getElementById("inner");
    const plots = new Map();
    for (let [series, { unit, data, revision, timestamp }] of metrics) {
        if (unit == "ms" && data.every(it => it >= 1000)) {
            unit = "sec";
            data = data.map(it => it / 1000);
        }
        else if (unit == "#instr") {
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
        let seriesName;
        const analysisStatsPrefix = 'analysis-stats/';
        // Check for aggregated series of form "analysis-stats/<seriesName>/<plotName>"
        //  - <seriesName> is the project (e.g. "ripgrep", "diesel")
        //  - <plotName> is the metric (e.g. "total memory", "total time"), it cannot contain a `/`
        if (plotName.startsWith(analysisStatsPrefix)) {
            const plotNameStart = plotName.lastIndexOf("/");
            const seriesNameStart = plotName.lastIndexOf("/", plotNameStart - 1);
            seriesName = plotName.substring(seriesNameStart + 1, plotNameStart);
            plotName = plotName.substring(plotNameStart + 1);
        }
        else {
            seriesName = series;
        }
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
                        rangemode: 'tozero'
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
                        orientation: window.innerWidth < 700 ? "h" : "v"
                    }
                }
            };
            plots.set(plotName, plot);
        }
        plot.data.push({
            name: seriesName,
            line: {
                shape: "hv",
            },
            x: timestamp.map(n => new Date(n * 1000)),
            y: data,
            hovertext: revision,
            hovertemplate: `%{y} ${unit}<br>(%{hovertext})`,
        });
    }
    for (const [title, definition] of plots) {
        const plotDiv = document.createElement("div");
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
        plotDiv.on("plotly_click", (data) => {
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
    const timestamp = +new Date() - (n * 1000 * 60 * 60 * 24);
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
    startInput.value = start ? start.toISOString().split("T")[0] : "";
    endInput.value = end ? end.toISOString().split("T")[0] : "";
}
main();
