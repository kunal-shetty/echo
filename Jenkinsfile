pipeline {
    agent any

    stages {
        stage('Install') {
            steps {
                sh 'pnpm install'
            }
        }
        stage('Lint') {
            steps {
                sh 'pnpm run lint'
            }
        }
        stage('Unit & Integration Tests') {
            steps {
                sh 'pnpm exec vitest run'
            }
        }
        stage('E2E Tests') {
            steps {
                sh 'pnpm exec playwright install --with-deps'
                sh 'pnpm exec playwright test'
            }
        }
    }
    post {
        always {
            junit '**/__tests__/**/*.xml'
        }
    }
}
