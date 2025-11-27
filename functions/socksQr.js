  document.getElementById('generate').addEventListener('click', function() {
        const input = document.getElementById('input').value.trim();
        const errorDiv = document.getElementById('error');
        const qrCodeDiv = document.getElementById('qrCode');
        const format =document.getElementById('format');
        const sel = format.options[format.selectedIndex].value;


        // 清除之前的错误信息和二维码
        errorDiv.textContent = "";
        qrCodeDiv.innerHTML = "";
        var iparr = input.split(/[\r\n\t]/);


        for (const key in iparr) {
            if (Object.prototype.hasOwnProperty.call(iparr, key)) {
                const element = iparr[key];
                var iparr1=element;
                if(iparr1.length<0){
                    continue;
                }
                if(iparr1.split(' ').length>1){
                    iparr1 = iparr1.split(' ')[1];
                }
                
                // 分割输入字符串
                const parts = iparr1.split(/[:|]/);

                if (parts.length < 4) {
                    errorDiv.textContent = "请输入正确的格式: 主机:端口:账户:密码";
                    return;
                }

                const [host, port, account, password] = parts;

                // 验证端口是否为数字
                if (isNaN(port) || port < 1 || port > 65535) {
                    errorDiv.textContent = "端口必须是1到65535之间的数字";
                    return;
                }

                // 编码账户和密码，防止特殊字符引起的问题
                const encodedAccount = encodeURIComponent(account);
                const encodedPassword = encodeURIComponent(password);

                // 根据选择的格式生成二维码数据
                let qrCodeData;

                var ipbiz=`${btoa(`${encodedAccount}:${encodedPassword}@${host}:${port}`)}`;
                if(sel=='http'){
                    // HTTP 格式
                    qrCodeData = "http://"+ipbiz+"?method=auto";
                }
                else if(sel=='ss'){
                    qrCodeData = "ss://"+ipbiz;
                }
                else{
                    // SOCKS 格式
                    qrCodeData = "socks://"+ipbiz+"?obfs=none&method=strict";
                }

                
                // 生成二维码
                new QRCode(qrCodeDiv, {
                    text: qrCodeData,
                    quiet: '30',
                    width: 256,
                    height: 256,
                    colorDark: "#000000",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.H
                });
                // 创建一个 `<div>` 元素
                const newDiv = document.createElement("div");
                newDiv.style.height="40px";
                newDiv.style.textAlign = 'left';
                // 创建一个文本节点
                const newContent = document.createTextNode(element);

                // 将文本节点添加到 div 元素中
                newDiv.appendChild(newContent);

                // 找到要添加到的父元素
                const currentDiv = document.getElementById("qrCode");

                // 将新的 div 元素添加到父元素的末尾
                currentDiv.appendChild(newDiv);
                

            }
        }

    });