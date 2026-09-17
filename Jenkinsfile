pipeline {
    agent any

    options {
        timeout(time: 40, unit: 'MINUTES')
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '15'))
        timestamps()
    }

    stages {
        stage('Bootstrap Docker CLI') {
            steps {
                sh '''
                    set -eu
                    if command -v docker > /dev/null 2>&1; then
                        echo "Docker CLI already present: $(docker --version)"
                        exit 0
                    fi

                    if [ "$(id -u)" = "0" ]; then
                        SUDO=""
                    elif command -v sudo > /dev/null 2>&1; then
                        SUDO="sudo"
                    else
                        echo "Docker CLI not found and no root/sudo privileges available on this Jenkins agent."
                        echo "Install Docker CLI on agent, run Jenkins agent as root, or grant sudo access."
                        exit 1
                    fi

                    ${SUDO} apt-get update -qq
                    ${SUDO} apt-get install -y --no-install-recommends ca-certificates curl gnupg
                    ${SUDO} install -m 0755 -d /etc/apt/keyrings
                    curl -fsSL https://download.docker.com/linux/debian/gpg | ${SUDO} gpg --dearmor -o /etc/apt/keyrings/docker.gpg
                    ${SUDO} chmod a+r /etc/apt/keyrings/docker.gpg
                    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo \\"$VERSION_CODENAME\\") stable" | ${SUDO} tee /etc/apt/sources.list.d/docker.list >/dev/null
                    ${SUDO} apt-get update -qq
                    ${SUDO} apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin
                '''
            }
        }

        stage('Preflight') {
            steps {
                sh '''
                    set -eux
                    docker --version
                    docker compose version
                '''
            }
        }

        stage('Deploy Prod') {
            steps {
                sh '''
                    set -eux
                    docker compose down --remove-orphans
                    docker compose up -d --build
                '''
            }
        }
    }
}

