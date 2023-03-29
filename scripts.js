const currentTimestamp = new Date().getTime();
const readmeUrl = `https://raw.githubusercontent.com/tubiana/tubiana/main/README.md?_=${currentTimestamp}`;

fetch(readmeUrl)
    .then(response => response.text())
    .then(text => {
        const converter = new showdown.Converter();
        const markdownContent = converter.makeHtml(text);
        document.getElementById('readme-content').innerHTML = markdownContent;
    })
    .catch(error => {
        console.error('Error fetching README.md:', error);
    });
