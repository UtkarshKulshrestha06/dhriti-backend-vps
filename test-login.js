async function test() {
    try {
        const res = await fetch('http://localhost:3001/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identifier: 'test@dhriti.com',
                password: 'test'
            })
        });
        const data = await res.json();
        console.log(data);
    } catch (e) {
        console.error(e);
    }
}
test();
